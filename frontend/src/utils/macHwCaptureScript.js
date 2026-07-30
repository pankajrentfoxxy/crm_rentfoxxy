/** One-liner Mac bash script: verify config then submit platform serial. */
export function buildMacCaptureCommand(apiBase, token, apiPrefix = 'grn-capture') {
  const base = `${apiBase}/${apiPrefix}/${token}`;
  return [
    'M=$(sysctl -n hw.model)',
    'MF=$(system_profiler SPHardwareDataType 2>/dev/null|awk -F\': \' \'/Model Name/{print $2;exit}\')',
    'C=$(system_profiler SPHardwareDataType 2>/dev/null|awk -F\': \' \'/Chip/{print $2;exit}\')',
    '[ -z "$C" ]&&C=$(sysctl -n machdep.cpu.brand_string 2>/dev/null||true)',
    '[ -z "$C" ]&&C="Apple Silicon"',
    'R=$(( $(sysctl -n hw.memsize)/1073741824 ))',
    'S=$(system_profiler SPNVMeDataType SPSerialATADataType 2>/dev/null|awk \'/Capacity/{print;exit}\'|grep -oE \'[0-9]+(\\.[0-9]+)?\'|head -1)',
    `V=$(curl -s -X POST "${base}/verify-configuration" -H "Content-Type: application/json" -d "{\\"manufacturer\\":\\"Apple\\",\\"model\\":\\"$M\\",\\"system_family\\":\\"$MF\\",\\"processor\\":\\"$C\\",\\"ram\\":\\"$R\\",\\"ssd\\":\\"$S\\",\\"gpu\\":\\"\\"}")`,
    'if [[ "$V" == *configurationMatched*true* ]];then',
    'SERIAL=$(ioreg -rd1 -c IOPlatformExpertDevice|awk \'/IOPlatformSerialNumber/{print $3;exit}\'|tr -d \'"\')',
    `curl -s -X POST "${base}" -H "Content-Type: application/json" -d "{\\"serial_number\\":\\"$SERIAL\\"}"`,
    'echo "Verified + serial sent: $SERIAL"',
    'else echo "Verification failed / config mismatch:";echo "$V";fi',
  ].join(';');
}
