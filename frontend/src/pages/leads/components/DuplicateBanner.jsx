import { AlertTriangle } from 'lucide-react';

export default function DuplicateBanner({ count }) {
    if (count <= 0) return null;

    return (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-2 px-3 mb-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {count} duplicate lead(s) detected.
        </div>
    );
}
