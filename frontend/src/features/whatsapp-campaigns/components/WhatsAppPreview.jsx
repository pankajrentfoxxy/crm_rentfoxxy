import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * WhatsApp-style chat bubble. `text` is the template body with variables already
 * filled in (server-rendered from the first valid contact).
 */
export default function WhatsAppPreview({ headerMediaUrl, text, bodyValues = [], templateName, contactName }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="rounded-2xl p-4 bg-[#e5ddd5] max-w-sm">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-[280px]">
        {headerMediaUrl && (
          imgFailed ? (
            <div className="h-36 bg-slate-100 flex flex-col items-center justify-center text-slate-400 text-xs gap-1">
              <ImageOff className="w-6 h-6" />
              Header media could not be loaded in the browser
            </div>
          ) : (
            <img
              src={headerMediaUrl}
              alt="Template header"
              className="w-full max-h-48 object-cover bg-slate-100"
              onError={() => setImgFailed(true)}
              referrerPolicy="no-referrer"
            />
          )
        )}
        <div className="px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap break-words">
          {text || (
            <span className="text-slate-500">
              Template <b>{templateName}</b> with
              {bodyValues.length
                ? bodyValues.map((v, i) => <span key={i}> {`{{${i + 1}}}`} = <b>{v}</b>{i < bodyValues.length - 1 ? ',' : ''}</span>)
                : ' no variables'}
              <br />
              <span className="text-xs">Paste the template body in campaign settings to see the full message.</span>
            </span>
          )}
        </div>
        <div className="px-3 pb-1 text-right text-[10px] text-slate-400">now</div>
      </div>
      {contactName && <p className="text-xs text-slate-600 mt-2">Preview for {contactName}</p>}
    </div>
  );
}
