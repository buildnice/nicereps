const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const keep = `<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@raw/timer" />
`;

module.exports = (config) => {
  config = withAppBuildGradle(config, (config) => {
    const from = 'getDefaultProguardFile("proguard-android.txt")';
    if (!config.modResults.contents.includes(from)) throw new Error(`r8-optimize: ${from} not found in app/build.gradle`);
    config.modResults.contents = config.modResults.contents.replace(from, 'getDefaultProguardFile("proguard-android-optimize.txt")');
    return config;
  });
  return withDangerousMod(config, [
    'android',
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/raw');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'keep_timer.xml'), keep);
      return config;
    },
  ]);
};
