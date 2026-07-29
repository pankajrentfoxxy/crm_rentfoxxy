import React from 'react';
import CameraScanner from './CameraScanner';

/**
 * Thin adapter kept for the screens that already scan with this prop shape
 * (Login, ticket creation, work timer, warehouse, procurement).
 *
 * The implementation lives in CameraScanner, which opens the rear camera
 * directly instead of the file-picker UI the html5-qrcode default scanner
 * renders.
 */
const BarcodeScanner = ({ onScanSuccess, onScanFailure }) => (
  <CameraScanner onScan={onScanSuccess} onError={onScanFailure} />
);

export default BarcodeScanner;
