module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Line wrapping isn't enforced in the body or footer. Their content still
  // counts: a `BREAKING CHANGE:` footer cuts a major release.
  rules: {
    'body-max-line-length': [0, 'always', 100],
    'footer-max-line-length': [0, 'always', 100],
  },
};
