package com.hotelpo.app;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    private OnBackPressedCallback backPressedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.addJavascriptInterface(new AndroidFileBridge(), "AndroidFileBridge");
        }

        backPressedCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView activeWebView = getBridge() != null ? getBridge().getWebView() : null;
                if (activeWebView == null) {
                    passBackPressToSystem();
                    return;
                }
                activeWebView.evaluateJavascript(
                    "(function(){ return typeof window.handleAndroidBack === 'function' ? Boolean(window.handleAndroidBack()) : false; })()",
                    result -> {
                        if (!"true".equals(result)) {
                            passBackPressToSystem();
                        }
                    }
                );
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backPressedCallback);
    }

    private void passBackPressToSystem() {
        if (backPressedCallback != null) {
            backPressedCallback.setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
            backPressedCallback.setEnabled(true);
        }
    }

    /**
     * Bridges Blob & jsPDF exports from the SPA to native Android storage and viewers.
     */
    private class AndroidFileBridge {
        @JavascriptInterface
        public void saveFile(String base64Data, String rawFilename, String rawMimeType) {
            String safeName = sanitizeFilename(rawFilename);
            String mimeType = resolveMimeType(rawMimeType, safeName);

            byte[] bytes;
            try {
                String cleanBase64 = base64Data == null ? "" : base64Data.trim();
                int commaIdx = cleanBase64.indexOf(',');
                if (cleanBase64.startsWith("data:") && commaIdx >= 0) {
                    cleanBase64 = cleanBase64.substring(commaIdx + 1);
                }
                bytes = Base64.decode(cleanBase64, Base64.DEFAULT);
            } catch (IllegalArgumentException ex) {
                showToast("Export failed: invalid file data.");
                return;
            }

            boolean savedToDownloads = writeToPublicDownloads(bytes, safeName, mimeType);
            File cacheFile;
            try {
                cacheFile = writeToShareCache(bytes, safeName);
            } catch (IOException ex) {
                showToast(savedToDownloads
                    ? "Saved to Downloads/HotelPO/" + safeName
                    : "Export failed: could not write file.");
                return;
            }

            Uri shareUri = FileProvider.getUriForFile(
                MainActivity.this,
                getPackageName() + ".fileprovider",
                cacheFile
            );

            runOnUiThread(() -> {
                String msg = savedToDownloads
                    ? "Saved to Downloads/HotelPO/" + safeName
                    : "Ready: " + safeName;
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                openOrShareFile(shareUri, safeName, mimeType);
            });
        }
    }

    private boolean writeToPublicDownloads(byte[] bytes, String filename, String mimeType) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/HotelPO");
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            Uri itemUri = null;
            try {
                itemUri = resolver.insert(collection, values);
                if (itemUri == null) return false;
                try (OutputStream out = resolver.openOutputStream(itemUri)) {
                    if (out == null) return false;
                    out.write(bytes);
                    out.flush();
                }
                ContentValues doneValues = new ContentValues();
                doneValues.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(itemUri, doneValues, null, null);
                return true;
            } catch (Exception ex) {
                if (itemUri != null) {
                    try {
                        resolver.delete(itemUri, null, null);
                    } catch (Exception ignored) {
                    }
                }
                return false;
            }
        }

        try {
            File downloadsRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File hotelDir = new File(downloadsRoot, "HotelPO");
            if (!hotelDir.exists() && !hotelDir.mkdirs()) {
                return false;
            }
            File target = uniqueTargetFile(hotelDir, filename);
            try (FileOutputStream fos = new FileOutputStream(target)) {
                fos.write(bytes);
                fos.flush();
            }
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    private File writeToShareCache(byte[] bytes, String filename) throws IOException {
        File exportsDir = new File(getCacheDir(), "exports");
        if (!exportsDir.exists() && !exportsDir.mkdirs()) {
            throw new IOException("Unable to create cache/exports directory");
        }
        File target = new File(exportsDir, filename);
        try (FileOutputStream fos = new FileOutputStream(target, false)) {
            fos.write(bytes);
            fos.flush();
        }
        return target;
    }

    private File uniqueTargetFile(File dir, String filename) {
        File candidate = new File(dir, filename);
        if (!candidate.exists()) return candidate;
        int dotIdx = filename.lastIndexOf('.');
        String stem = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
        String ext = dotIdx > 0 ? filename.substring(dotIdx) : "";
        for (int i = 1; i < 1000; i++) {
            File next = new File(dir, stem + " (" + i + ")" + ext);
            if (!next.exists()) return next;
        }
        return candidate;
    }

    private void openOrShareFile(Uri uri, String filename, String mimeType) {
        Intent viewIntent = new Intent(Intent.ACTION_VIEW);
        viewIntent.setDataAndType(uri, mimeType);
        viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(viewIntent, "Open " + filename));
        } catch (ActivityNotFoundException ex) {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, filename);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(Intent.createChooser(shareIntent, "Save or Share " + filename));
            } catch (ActivityNotFoundException ignored) {
                showToast("File saved to Downloads/HotelPO/" + filename);
            }
        }
    }

    private void showToast(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    private static String sanitizeFilename(String raw) {
        String base = raw == null ? "" : new File(raw.trim()).getName();
        base = base.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");
        if (base.isEmpty() || ".".equals(base) || "..".equals(base)) {
            return "hotel-po-export.bin";
        }
        if (base.getBytes(StandardCharsets.UTF_8).length > 180) {
            int dot = base.lastIndexOf('.');
            String ext = dot > 0 ? base.substring(dot) : "";
            base = base.substring(0, Math.min(120, base.length())) + ext;
        }
        return base;
    }

    private static String resolveMimeType(String rawMime, String filename) {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".json")) return "application/json";
        if (rawMime != null && !rawMime.trim().isEmpty()) {
            int semi = rawMime.indexOf(';');
            return (semi >= 0 ? rawMime.substring(0, semi) : rawMime).trim();
        }
        return "application/octet-stream";
    }
}
