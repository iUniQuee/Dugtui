import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';

export function QrModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-100">
            <X className="w-5 h-5 text-neutral-500" />
          </button>
        </div>
        <div className="mx-auto w-fit rounded-2xl border-4 border-neutral-900 p-4 bg-white">
          <QRCodeSVG value={url} size={200} />
        </div>
        <p className="mt-4 text-xs text-neutral-500 break-all">{url}</p>
      </div>
    </div>
  );
}
