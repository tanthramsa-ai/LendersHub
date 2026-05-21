// Extends app.json. On EAS builds, GOOGLE_SERVICES_JSON is the path to the
// secret file uploaded via: eas env:create --name GOOGLE_SERVICES_JSON --type file --visibility secret
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json',
  },
});
