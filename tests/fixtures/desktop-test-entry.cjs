// Copied only into disposable verification apps. The release app has no
// test-profile or Node inspector entry point.
const { app } = require('electron');
app.setPath('appData', process.env.BRAKE_LAB_TEST_PROFILE_PARENT);
if (app.isPackaged && app.commandLine.getSwitchValue('inspect') === '0') {
  require('node:inspector').open(0, '127.0.0.1');
}
require('./main.cjs');
