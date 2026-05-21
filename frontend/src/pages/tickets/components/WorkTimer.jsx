// Work Timer Component
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../utils/api';
import BarcodeScanner from '../../../components/BarcodeScanner';
import { Clock, X, Scan } from 'lucide-react';

export default function WorkTimer({ ticketId, serialNumber, machineNumber, assignedUserId, onStatusChange }) {
    const { user } = useAuth();
    const [activeLog, setActiveLog] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showScanner, setShowScanner] = useState(false);
  
    const [showNoteModal, setShowNoteModal] = useState(false);
    const [note, setNote] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const [manualCode, setManualCode] = useState('');
  
    const checkStatus = useCallback(async () => {
      try {
        const { data } = await api.get(`/tickets/${ticketId}/work/active`);
        if (data.active) {
          setActiveLog(data.log);
          onStatusChange('active');
        } else {
          setActiveLog(null);
          onStatusChange('idle');
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }, [ticketId, onStatusChange]);
  
    // Check status on mount
    useEffect(() => {
      checkStatus();
    }, [checkStatus]);
  
    // Timer interval
    useEffect(() => {
      let interval;
      if (activeLog && !activeLog.end_time) {
        let startTime;
        if (activeLog.start_time_epoch) {
          // Use server-provided epoch (ms) for absolute accuracy
          startTime = parseFloat(activeLog.start_time_epoch);
        } else {
          // Fallback: Fix Timezone manually
          const timeStr = activeLog.start_time;
          startTime = new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').getTime();
        }
  
        interval = setInterval(() => {
          setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
      } else {
        setElapsed(0);
      }
      return () => clearInterval(interval);
    }, [activeLog]);
  
    const handleScan = async (decodedText) => {
      setShowScanner(false);
  
      // Determine mode based on activeLog status
      // If we have an active log, we are ENDING work.
      // If not, we are STARTING work.
      const isEnding = !!activeLog;
  
      if (!isEnding) {
        // START WORK LOGIC
        // Validate barcode: Prefer Machine Number, fallback to Serial
        const expected = machineNumber || serialNumber;
        if (decodedText !== expected) {
          alert(`Barcode Mismatch! Scanned: ${decodedText}. Expected: ${expected}`);
          return;
        }
  
        try {
          await api.post(`/tickets/${ticketId}/work/start`);
          alert('Work Started! Timer detected.');
          checkStatus();
          setManualCode('');
        } catch (e) {
          alert(e.response?.data?.message || 'Failed to start work');
        }
      } else {
        // END WORK LOGIC
        // Validate barcode: Prefer Machine Number, fallback to Serial
        const expected = machineNumber || serialNumber;
        if (decodedText !== expected) {
          alert(`Barcode Mismatch! Scanned: ${decodedText}. Expected: ${expected}`);
          return;
        }
        // Open Note Modal
        setShowNoteModal(true);
        setManualCode('');
      }
    };
  
    const submitEndWork = async (e) => {
      e.preventDefault();
      try {
        const { data } = await api.post(`/tickets/${ticketId}/work/end`, { notes: note });
        alert('Work Ended. ' + (data.ready_for_next_stage ? 'Moving to next stage...' : ''));
        setActiveLog(null);
        setShowNoteModal(false);
        setNote('');
        onStatusChange('completed', data.ready_for_next_stage); // Trigger move next if ready
      } catch (e) {
        alert(e.response?.data?.message || 'Failed to end work');
      }
    };
  
    const formatTime = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };
  
    // Only show for assigned user or manager overrides
    // Note: user.user_id is int, assignedUserId might be string/int. Compare loosely.
    // Requirement: "Team member of any team can move ticket"
    // So we allow any logged in user to see the timer if they are on the page.
    // Ideally, maybe restriction to team? But user said "Team member of ANY team".
    if (!user) return null;
  
    if (loading) return <div className="text-sm">Loading timer...</div>;
  
    return (
      <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-4 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-600" />
            Work Timer
          </h3>
          <div className="font-mono text-xl font-bold text-orange-600">
            {activeLog ? formatTime(elapsed) : '00:00:00'}
          </div>
        </div>
  
        {!activeLog ? (
          // Start Work UI
          <div>
            <p className="text-sm text-gray-600 mb-3">Scan machine ({machineNumber || serialNumber}) to START working.</p>
            {showScanner ? (
              <div className="border rounded p-2">
                <div className="flex justify-between mb-2">
                  <span className="font-bold text-xs">Scanning...</span>
                  <button onClick={() => setShowScanner(false)}><X className="w-4 h-4" /></button>
                </div>
                <BarcodeScanner onScanSuccess={handleScan} />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Manual / Physical Scanner Input */}
                <form onSubmit={(e) => { e.preventDefault(); handleScan(manualCode); }} className="flex gap-2">
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Click here & Scan with Gun"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    autoFocus
                  />
                  <button type="submit" disabled={!manualCode} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold">Go</button>
                </form>
  
                <button
                  onClick={() => { setShowScanner(true); }}
                  className="w-full bg-blue-100 text-blue-800 py-3 rounded-lg font-bold hover:bg-blue-200 flex justify-center items-center gap-2 border border-blue-200"
                >
                  <Scan className="w-5 h-5" /> Or Use Camera
                </button>
              </div >
            )}
          </div >
        ) : (
          // End Work UI
          <div>
            <p className="text-sm text-green-600 mb-3 font-medium">Work in progress...</p>
            {showScanner ? (
              <div className="border rounded p-2">
                <div className="flex justify-between mb-2">
                  <span className="font-bold text-xs">Scan to END...</span>
                  <button onClick={() => setShowScanner(false)}><X className="w-4 h-4" /></button>
                </div>
                <BarcodeScanner onScanSuccess={handleScan} />
              </div>
            ) : (
  
              <div className="space-y-3">
                {/* Manual / Physical Scanner Input */}
                <form onSubmit={(e) => { e.preventDefault(); handleScan(manualCode); }} className="flex gap-2">
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Click here & Scan to END"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    autoFocus
                  />
                  <button type="submit" disabled={!manualCode} className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-bold">End</button>
                </form>
  
                <button
                  onClick={() => { setShowScanner(true); }}
                  className="w-full bg-red-100 text-red-800 py-3 rounded-lg font-bold hover:bg-red-200 flex justify-center items-center gap-2 border border-red-200"
                >
                  <Scan className="w-5 h-5" /> Or Use Camera
                </button>
              </div>
            )}
          </div>
        )
        }
  
        {/* End Work Note Modal */}
        {
          showNoteModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl p-6 w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Work Completion Note</h3>
                <form onSubmit={submitEndWork}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">What did you do? (Mandatory)</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full border rounded-lg p-3 mb-4 focus:ring-2 focus:ring-blue-500"
                    rows="3"
                    required
                    placeholder="Replaced thermal paste, cleaned fan..."
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowNoteModal(false)}
                      className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                    >
                      Submit & Finish
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )
        }
      </div >
    );
  }
  