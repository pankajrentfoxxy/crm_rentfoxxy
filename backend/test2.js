/**
 * BlueDart GenerateWayBill — fully hardcoded smoke test (no shared helpers).
 * Usage: node test2.js
 */
const fs = require('fs');
const axios = require('axios');

async function generateWaybill() {
  try {
    // Hardcoded future pickup: 14 Aug 2026 15:30 IST = /Date(1786701600000)/
    // (IST = UTC+5:30 → 14 Aug 2026 10:00 UTC)
    const payload = {
      Request: {
        Consignee: {
          ConsigneeAddress1: 'C/O Apna Mart 3rd Floor Maple Plaza Ashok Nagar Argora Ranchi Jharkhand',
          ConsigneeAddress2: '',
          ConsigneeAddress3: '',
          ConsigneeAddressType: 'R',
          ConsigneeAttention: 'Ravi',
          ConsigneeEmailID: '',
          ConsigneeGSTNumber: '',
          ConsigneeMobile: '8271787197',
          ConsigneeName: 'FLEET',
          ConsigneePincode: '834002',
          ConsigneeTelephone: '',
        },
        Returnadds: {
          ReturnAddress1: 'B-12 OMAXE CITY CENTRE, SOHNA ROAD GURGAON',
          ReturnAddress2: '',
          ReturnAddress3: '',
          ReturnContact: 'TRUETECH SERVICES P LTD',
          ReturnEmailID: '',
          ReturnMobile: '9311770430',
          ReturnPincode: '122018',
          ReturnTelephone: '',
        },
        Services: {
          AWBNo: '',
          ActualWeight: '2.50',
          DeclaredValue: 36000,
          Commodity: {
            CommodityDetail1: 'LAPTOP',
            CommodityDetail2: '',
            CommodityDetail3: '',
          },
          // Must be UNIQUE every run (max 20). Reusing an old ref → AWBGenerationFailure.
          CreditReferenceNo: `5CG0278V2Z-${String(Date.now()).slice(-4)}`,
          Dimensions: [
            {
              Length: 47,
              Breadth: 29,
              Height: 10,
              Count: 1,
            },
          ],
          PDFOutputNotRequired: false,
          PackType: '',
          PickupDate: '/Date(1786701600000)/',
          PickupTime: '1530',
          PieceCount: '1',
          ProductCode: 'A',
          ProductType: 0,
          RegisterPickup: true,
          IsForcePickup: true,
          IsReversePickup: false,
          SpecialInstruction: 'HANDLE WITH CARE',
          SubProductCode: 'P',
          OTPBasedDelivery: 0,
          OTPCode: '',
          itemdtl: [
            {
              ItemID: 1,
              ItemName: 'LAPTOP',
              ProductDesc1: 'LAPTOP',
              ItemValue: 36000,
              ItemQuantity: 1,
            },
          ],
          noOfDCGiven: 0,
        },
        Shipper: {
          CustomerAddress1: 'B-12 OMAXE CITY CENTRE, SOHNA ROAD GURGAON',
          CustomerAddress2: '',
          CustomerAddress3: '',
          CustomerCode: '988621',
          CustomerEmailID: '',
          CustomerGSTNumber: '',
          CustomerMobile: '9311770430',
          CustomerName: 'TRUETECH SERVICES P LTD',
          CustomerPincode: '122018',
          CustomerTelephone: '',
          IsToPayCustomer: false,
          OriginArea: 'GGN',
          Sender: 'TRUETECH',
          VendorCode: '',
        },
      },
      Profile: {
        Api_type: 'S',
        LicenceKey: 'piloljokqgooftklrfgrqnrjhsnkqjkp',
        LoginID: 'GGN37318',
      },
    };

    console.log('========== REQUEST PAYLOAD ==========');
    console.log(JSON.stringify(payload, null, 2));
    fs.writeFileSync('test2_payload.json', JSON.stringify(payload, null, 2));

    // Paste a valid JWT here (or replace with your token endpoint call)
    const JWTToken =
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdWJqZWN0LXN1YmplY3QiLCJhdWQiOlsiYXVkaWVuY2UxIiwiYXVkaWVuY2UyIl0sImlzcyI6InVybjovL2FwaWdlZS1lZGdlLUpXVC1wb2xpY3ktdGVzdCIsImV4cCI6MTc4NjY5MDIwMCwiaWF0IjoxNzg2NjAzODAwLCJqdGkiOiI1MmZjZmRjMC01YzFiLTQ2NGMtYjZiNi0yNjZmMzg3NjJjOGEifQ.PUCc-sHW88GX2_n5tmV4_AuTTc1m2CGqPC6aGJvXXfw';

    const response = await axios.post(
      'https://apigateway.bluedart.com/in/transportation/waybill/v1/GenerateWayBill',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          JWTToken,
        },
        timeout: 45000,
        validateStatus: () => true, // so we can read BlueDart Status on 400
      }
    );

    console.log('\n========== HTTP STATUS ==========', response.status);
    console.log('========== RAW RESPONSE (trimmed) ==========');
    console.log(JSON.stringify(response.data, null, 2).slice(0, 4000));

    const result =
      response.data?.GenerateWayBillResult
      || response.data?.['error-response']?.[0]
      || response.data;

    const { AWBPrintContent, ...safe } = result || {};
    console.log('\n========== API RESULT (no PDF bytes) ==========');
    console.log(JSON.stringify(safe, null, 2));
    fs.writeFileSync('test2_response.json', JSON.stringify(safe, null, 2));

    console.log('\n========== STATUS MESSAGES ==========');
    console.log(JSON.stringify(result?.Status || result?.status || [], null, 2));

    console.log('\n========== PICKUP CHECK ==========');
    console.log('RegisterPickup:', payload.Request.Services.RegisterPickup);
    console.log('PickupDate:', payload.Request.Services.PickupDate);
    console.log('PickupTime:', payload.Request.Services.PickupTime);
    console.log('TokenNumber:', result?.TokenNumber ?? null);
    console.log('ShipmentPickupDate:', result?.ShipmentPickupDate ?? null);
    console.log('IsErrorInPU:', result?.IsErrorInPU ?? null);

    if (result?.IsError || response.status >= 400) {
      console.log('❌ API Error — see STATUS MESSAGES above');
      return;
    }

    console.log('✅ AWB Generated:', result.AWBNo);

    if (result.AWBPrintContent) {
      const pdfBuffer = Buffer.from(result.AWBPrintContent);
      const fileName = `waybill_${result.AWBNo}.pdf`;
      fs.writeFileSync(fileName, pdfBuffer);
      console.log('📄 PDF Saved:', fileName);
    }
  } catch (error) {
    console.error('❌ Request Failed:', JSON.stringify(error.response?.data || error.message, null, 2));
  }
}

generateWaybill();
