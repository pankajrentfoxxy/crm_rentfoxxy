import React, { useState } from 'react';
import { Save, CheckSquare, Square, MessageSquare } from 'lucide-react';

export default function SoftwareChecklist({ onSubmit, processing }) {
    const [checks, setChecks] = useState({
        windows_installation: false,
        bios_update: false,
        driver_installation: false
    });
    const [notes, setNotes] = useState('');

    const toggleCheck = (key) => {
        setChecks(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        // Ensure at least one is checked? User said "select These 3 Check Box". 
        // Usually means they should do all, but we'll let them select what they did.
        // Mandatory Comment Check
        if (!notes.trim()) {
            alert('Please add a comment describing the work done (Mandatory).');
            return;
        }

        onSubmit(checks, notes);
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-blue-600" />
                Assembly & Software Checklist
            </h3>

            <div className="space-y-4 mb-6">
                <div
                    onClick={() => toggleCheck('windows_installation')}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                    {checks.windows_installation ?
                        <CheckSquare className="w-5 h-5 text-green-600" /> :
                        <Square className="w-5 h-5 text-gray-400" />
                    }
                    <span className={checks.windows_installation ? 'text-gray-900 font-medium' : 'text-gray-600'}>
                        Windows Installation
                    </span>
                </div>

                <div
                    onClick={() => toggleCheck('bios_update')}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                    {checks.bios_update ?
                        <CheckSquare className="w-5 h-5 text-green-600" /> :
                        <Square className="w-5 h-5 text-gray-400" />
                    }
                    <span className={checks.bios_update ? 'text-gray-900 font-medium' : 'text-gray-600'}>
                        BIOS Update
                    </span>
                </div>

                <div
                    onClick={() => toggleCheck('driver_installation')}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                >
                    {checks.driver_installation ?
                        <CheckSquare className="w-5 h-5 text-green-600" /> :
                        <Square className="w-5 h-5 text-gray-400" />
                    }
                    <span className={checks.driver_installation ? 'text-gray-900 font-medium' : 'text-gray-600'}>
                        Drivers Installed
                    </span>
                </div>
            </div>

            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Technician Comments & Details <span className="text-red-500">*</span>
                </label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Enter details about installation (e.g. Windows 11 Pro, BIOS v1.2)..."
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows="3"
                />
            </div>

            <button
                onClick={handleSubmit}
                disabled={processing}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {processing ? 'Processing...' : 'Submit & Finish Assembly & Software'}
                <Save className="w-4 h-4" />
            </button>
        </div>
    );
}
