const { execSync } = require('child_process');
const os = require('os');

function cleanSerial(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s || s === 'DEFAULT STRING' || s === 'SYSTEM SERIAL NUMBER' || s === 'TO BE FILLED BY O.E.M.') {
    return null;
  }
  return s;
}

/**
 * Read the hardware serial number from the machine running this process (Windows / macOS).
 */
function readHostSerialNumber() {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_BIOS).SerialNumber"',
        { encoding: 'utf8', timeout: 15000, windowsHide: true }
      );
      return cleanSerial(out);
    }
    if (platform === 'darwin') {
      const out = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformSerialNumber/ { print $3; exit }'",
        { encoding: 'utf8', timeout: 15000, shell: '/bin/bash' }
      );
      return cleanSerial(out.replace(/"/g, ''));
    }
    if (platform === 'linux') {
      try {
        const out = execSync('cat /sys/class/dmi/id/product_serial 2>/dev/null', {
          encoding: 'utf8',
          timeout: 5000,
          shell: '/bin/bash'
        });
        const s = cleanSerial(out);
        if (s) return s;
      } catch {
        /* fall through */
      }
      const out = execSync('dmidecode -s system-serial-number 2>/dev/null', {
        encoding: 'utf8',
        timeout: 10000,
        shell: '/bin/bash'
      });
      return cleanSerial(out);
    }
  } catch (err) {
    return { error: err.message || 'Could not read serial number' };
  }
  return { error: `Unsupported platform: ${platform}` };
}

module.exports = { readHostSerialNumber, cleanSerial };
