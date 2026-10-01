import React from 'react';

/**
 * The second line under a laptop's TTSPL in every stock list: its serial
 * number, then its model. The serial is what is printed on the laptop, so a
 * person holding one can match it to the row without opening the record.
 * A row with no TTSPL already shows the serial as its main value.
 */
export function laptopSub(r) {
  const serial = r.ttspl_id || r.asset_code ? r.serial_number : null;
  const model = r.model_name;
  if (!serial && !model) return null;
  return (
    <>
      {serial && <span className="block">S/N: {serial}</span>}
      {model && <span className="block">{model}</span>}
    </>
  );
}

export default laptopSub;
