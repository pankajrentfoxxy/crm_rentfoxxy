const fs = require("fs");
const axios = require("axios");

async function generateWaybill() {
  try {
    const response = await axios.post(
      "https://apigateway.bluedart.com/in/transportation/waybill/v1/GenerateWayBill",
      {
        Request: {
          Consignee: {
            ConsigneeAddress1: "C/O Apna Mart 3rd Floor Maple Plaza Ashok Nagar Argora Ranchi Jharkhand",
            ConsigneeAddress2: "",
            ConsigneeAddress3: "",
            ConsigneeAddressType: "R",
            ConsigneeAttention: "Ravi",
            ConsigneeEmailID: "",
            ConsigneeGSTNumber: "",
            ConsigneeMobile: "8271787197",
            ConsigneeName: "FLEET",
            ConsigneePincode: "834002",
            ConsigneeTelephone: ""
          },
          Returnadds: {
            ReturnAddress1: "B-12 OMAXE CITY CENTRE, SOHNA ROAD GURGAON",
            ReturnAddress2: "",
            ReturnAddress3: "",
            ReturnContact: "TRUETECH SERVICES P LTD",
            ReturnEmailID: "",
            ReturnMobile: "9311770430",
            ReturnPincode: "122018",
            ReturnTelephone: ""
          },
          Services: {
            AWBNo: "",
            ActualWeight: "2.50",
            DeclaredValue: 36000,
            Commodity: {},
            CreditReferenceNo: "RFX-20260810-6",
            Dimensions: [
              {
                Length: 47,
                Breadth: 29,
                Height: 10,
                Count: 1
              }
            ],
            PDFOutputNotRequired: false,
            PackType: "",
            PickupDate: "/Date(1786406400000)/",
            PickupTime: "1530",
            PieceCount: "1",
            ProductCode: "A",
            ProductType: 0,
            RegisterPickup: false,
            SpecialInstruction: "",
            SubProductCode: "P",
            OTPBasedDelivery: 0,
            OTPCode: "",
            itemdtl: [
              {
                ItemID: 1,
                ItemName: "LAPTOP",
                ProductDesc1: "LAPTOP",
                ItemValue: 36000,
                ItemQuantity: 1
              }
            ],
            noOfDCGiven: 0
          },
          Shipper: {
            CustomerAddress1: "B-12 OMAXE CITY CENTRE, SOHNA ROAD GURGAON",
            CustomerAddress2: "",
            CustomerAddress3: "",
            CustomerCode: "988621",
            CustomerEmailID: "",
            CustomerGSTNumber: "",
            CustomerMobile: "9311770430",
            CustomerName: "TRUETECH SERVICES P LTD",
            CustomerPincode: "122018",
            CustomerTelephone: "",
            IsToPayCustomer: false,
            OriginArea: "GGN",
            Sender: "TRUETECH",
            VendorCode: ""
          }
        },
        Profile: {
          Api_type: "S",
          LicenceKey: "piloljokqgooftklrfgrqnrjhsnkqjkp",
          LoginID: "GGN37318"
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "JWTToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzdWJqZWN0LXN1YmplY3QiLCJhdWQiOlsiYXVkaWVuY2UxIiwiYXVkaWVuY2UyIl0sImlzcyI6InVybjovL2FwaWdlZS1lZGdlLUpXVC1wb2xpY3ktdGVzdCIsImV4cCI6MTc4NjY5MDIwMCwiaWF0IjoxNzg2NjAzODAwLCJqdGkiOiI1MmZjZmRjMC01YzFiLTQ2NGMtYjZiNi0yNjZmMzg3NjJjOGEifQ.PUCc-sHW88GX2_n5tmV4_AuTTc1m2CGqPC6aGJvXXfw"
        }
      }
    );

    const result = response.data.GenerateWayBillResult;

    if (result.IsError) {
      console.log("❌ API Error:", result.Status);
      return;
    }

    console.log("✅ AWB Generated:", result.AWBNo);

    // 🔥 Convert byte array → PDF
    const pdfBuffer = Buffer.from(result.AWBPrintContent);

    const fileName = `waybill_${result.AWBNo}.pdf`;

    fs.writeFileSync(fileName, pdfBuffer);

    console.log("📄 PDF Saved:", fileName);

  } catch (error) {
    console.error("❌ Request Failed:", error.response?.data || error.message);
  }
}

generateWaybill();