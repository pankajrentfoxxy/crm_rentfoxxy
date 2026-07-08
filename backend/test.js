require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const to = process.env.TWILIO_WHATSAPP_TO || 'whatsapp:+917081002501';
const contentSid = process.env.TWILIO_CONTENT_SID || 'HXb5b62575e6e4ff6129ad7c8efe1f983e';

if (!accountSid || !authToken) {
  console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in backend/.env');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

async function createMessage() {
  try {
    const message = await client.messages.create({
      from,
      contentSid,
      contentVariables: JSON.stringify({ 1: '12/1', 2: '3pm' }),
      to,
    });
    console.log('Message SID:', message.sid);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.code === 63007) {
      console.error(
        '\nTwilio WhatsApp is not set up for this From number.\n'
        + '- Sandbox: join the sandbox from your phone (Twilio Console → Messaging → WhatsApp sandbox).\n'
        + '- Use from: whatsapp:+14155238886 only after joining the sandbox.\n'
        + '- Production: use your approved WhatsApp Business sender in TWILIO_WHATSAPP_FROM.'
      );
    }
    process.exit(1);
  }
}

createMessage();
