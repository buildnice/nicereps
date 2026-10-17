const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// Health Connect links "privacy policy" in its permission screens to these intents; open the policy in the browser.
const policy = 'https://buildnice.app/nicereps/privacy/';
const name = 'HealthPrivacyActivity';

const activity = (pkg) => `package ${pkg}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class ${name} : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${policy}")))
    } catch (_: Exception) {}
    finish()
  }
}
`;

module.exports = (config) => {
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const pkg = config.android.package;
      const dir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name}.kt`), activity(pkg));
      return config;
    },
  ]);
  return withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.activity = (app.activity ?? []).filter((a) => a.$['android:name'] !== `.${name}`);
    app.activity.push({
      $: { 'android:name': `.${name}`, 'android:exported': 'true', 'android:theme': '@android:style/Theme.Translucent.NoTitleBar' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }] }],
    });
    app['activity-alias'] = (app['activity-alias'] ?? []).filter((a) => a.$['android:name'] !== 'ViewPermissionUsageActivity');
    app['activity-alias'].push({
      $: { 'android:name': 'ViewPermissionUsageActivity', 'android:exported': 'true', 'android:targetActivity': `.${name}`, 'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }], category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }] }],
    });
    return config;
  });
};
