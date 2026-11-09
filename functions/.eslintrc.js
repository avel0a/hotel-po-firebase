module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    quotes: ["error", "double"],
    "max-len": "off",
    "indent": "off",
    "object-curly-spacing": "off",
    "require-jsdoc": "off",
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
};
