// Extends app.json. On EAS builds, GOOGLE_SERVICES_JSON is written to a temp
// path by EAS (uploaded via: eas env:create --name GOOGLE_SERVICES_JSON --type file --visibility sensitive).
// When not set (local dev or CI without the secret), googleServicesFile is omitted
// so expo prebuild does not add the google-services plugin and the build succeeds
// without Firebase (push notifications won't work but the rest of the app does).
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || null;
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
