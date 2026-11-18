module.exports = {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes its own commit bodies. `Signed-off-by` is a footer line,
  // so match it anywhere in the message.
  ignores: [(message) => /Signed-off-by: dependabot\[bot\]/.test(message)],
  // Only the header type decides a release. Body and footer wrapping carries no
  // signal, so don't gate on it.
  rules: {
    'body-max-line-length': [0, 'always', 100],
    'footer-max-line-length': [0, 'always', 100],
  },
};
