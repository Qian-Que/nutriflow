const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = function withLocalNetwork(config) {
  config = withAndroidManifest(config, config => {
    const app = config.modResults.manifest.application[0];
    app.$['android:networkSecurityConfig'] = '@xml/nutriflow_network_security';
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(path.join(__dirname, 'nutriflow_network_security.xml'), path.join(directory, 'nutriflow_network_security.xml'));
    return config;
  }]);
};
