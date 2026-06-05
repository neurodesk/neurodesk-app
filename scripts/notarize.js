/* Based on https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/ */
/* Signing and notarizing an Electron app https://til.simonwillison.net/electron/sign-notarize-electron-macos#:~:text=The%20CSC_KEY_PASSWORD%20was%20the%20password,to%20work%20with%20GitHub%20actions. */

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (
    electronPlatformName !== 'darwin' ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'
  ) {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'org.neurodesk.neurodeskapp',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS,
    tool: 'notarytool',
    teamId: process.env.APPLE_TEAM_ID
  });
};
