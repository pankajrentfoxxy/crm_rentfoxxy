import React, { useEffect, useRef } from 'react'; // turbo-all
import { Html5QrcodeScanner } from 'html5-qrcode';

const BarcodeScanner = ({ onScanSuccess, onScanFailure }) => {
    const scannerRef = useRef(null);

    useEffect(() => {
        // Initialize scanner
        const scanner = new Html5QrcodeScanner(
            "reader",
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                formatsToSupport: [
                    0, // QR_CODE
                    1, // AZTEC
                    2, // CODABAR
                    3, // CODE_39
                    4, // CODE_93
                    5, // CODE_128
                    6, // DATA_MATRIX
                    7, // MAXICODE
                    8, // ITF
                    9, // EAN_13
                    10, // EAN_8
                    11, // PDF_417
                    12, // RSS_14
                    13, // RSS_EXPANDED
                    14, // UPC_A
                    15, // UPC_E
                    16, // UPC_EAN_EXTENSION
                ]
            },
      /* verbose= */ false
        );

        const successCallback = (decodedText, decodedResult) => {
            onScanSuccess(decodedText, decodedResult);
            // Optional: Stop scanning after first success if you want to close modal immediately
            // scanner.clear(); 
        };

        const errorCallback = (errorMessage) => {
            if (onScanFailure) {
                onScanFailure(errorMessage);
            }
        };

        scanner.render(successCallback, errorCallback);
        scannerRef.current = scanner;

        // Cleanup
        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(error => {
                    console.error("Failed to clear html5-qrcode scanner. ", error);
                });
            }
        };
    }, [onScanSuccess, onScanFailure]);

    return (
        <div className="w-full max-w-sm mx-auto">
            <div id="reader" className="w-full"></div>
            <p className="text-center text-sm text-gray-500 mt-2">
                Point camera at a barcode to scan
            </p>
        </div>
    );
};

export default BarcodeScanner;
