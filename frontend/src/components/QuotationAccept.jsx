import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import api from '../utils/api';

export default function QuotationAccept() {
    const { token } = useParams();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState(null);
    const [accepted, setAccepted] = useState(false);

    const loadPreview = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { data } = await api.get(`/quotation/accept/${encodeURIComponent(token)}`);
            setPreview(data);
            if (data.accepted_at) {
                setAccepted(true);
            }
        } catch (err) {
            const msg =
                err.response?.data?.message ||
                (err.message && err.message !== 'Network Error' ? err.message : null) ||
                'This quotation link is invalid or has expired.';
            setError(msg);
            setPreview(null);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (token) loadPreview();
    }, [token, loadPreview]);

    const handleAccept = async () => {
        setSubmitting(true);
        setError('');
        try {
            const { data } = await api.post(`/quotation/accept/${encodeURIComponent(token)}`);
            setAccepted(true);
            setPreview((p) => ({
                ...p,
                accepted_at: data.accepted_at || new Date().toISOString(),
                estimate_no: data.estimate_no || p?.estimate_no,
                company_name: data.company_name || p?.company_name
            }));
        } catch (err) {
            setError(err.response?.data?.message || 'Could not record acceptance. Please try again or contact us.');
        } finally {
            setSubmitting(false);
        }
    };

    const companyName = preview?.company_name || 'your organization';
    const estimateNo = preview?.estimate_no;
    const showAccepted = accepted || Boolean(preview?.accepted_at);

    return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <img src="/rentfoxxy-logo.png" alt="Rentfoxxy" className="h-10 mx-auto mb-4" />
                        <h1 className="text-xl font-bold text-slate-900">Rental laptop quotation</h1>
                    </div>

                    <div className="bg-white border border-orange-200 rounded-xl shadow-sm p-6">
                        {loading && (
                            <div className="flex justify-center py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                            </div>
                        )}

                        {!loading && error && (
                            <div className="text-center text-red-600">
                                <AlertTriangle className="w-10 h-10 mx-auto mb-3" />
                                <p className="text-sm">{error}</p>
                            </div>
                        )}

                        {!loading && !error && showAccepted && (
                            <div className="text-center">
                                <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
                                <h2 className="text-lg font-semibold text-slate-900 mb-2">Quotation accepted</h2>
                                <p className="text-sm text-slate-600 mb-1">
                                    Thank you. We have recorded your acceptance
                                    {estimateNo ? ` for ${estimateNo}` : ''}.
                                </p>
                                <p className="text-sm text-slate-600">
                                    <strong>{companyName}</strong> — our team will contact you shortly.
                                </p>
                                <p className="text-xs text-slate-400 mt-4">
                                    A confirmation email has been sent to your inbox.
                                </p>
                            </div>
                        )}

                        {!loading && !error && !showAccepted && preview && (
                            <AcceptQuotationForm
                                companyName={companyName}
                                estimateNo={estimateNo}
                                submitting={submitting}
                                onAccept={handleAccept}
                            />
                        )}

                        {!loading && !error && !showAccepted && !preview && (
                            <div className="text-center text-slate-600 text-sm">
                                <p>Unable to load this quotation link.</p>
                                <button
                                    type="button"
                                    onClick={loadPreview}
                                    className="mt-3 text-orange-500 font-medium hover:underline"
                                >
                                    Try again
                                </button>
                            </div>
                        )}
                    </div>

                    <p className="text-center text-xs text-slate-400 mt-6">
                        <Link to="/login" className="text-orange-500 hover:underline">
                            Rentfoxxy CRM
                        </Link>
                    </p>
                </div>
        </div>
    );
}

function AcceptQuotationForm({ companyName, estimateNo, submitting, onAccept }) {
    return (
        <div className="text-center">
            <p className="text-sm text-slate-600 mb-4">
                Please confirm that you accept the rental laptop quotation for <strong>{companyName}</strong>
                {estimateNo ? (
                    <>
                        {' '}
                        (<span className="font-mono text-xs">{estimateNo}</span>)
                    </>
                ) : null}
                .
            </p>
            <button
                type="button"
                onClick={onAccept}
                disabled={submitting}
                className="w-full bg-orange-400 hover:bg-orange-500 disabled:opacity-60 text-white font-semibold rounded-lg py-3 text-sm flex items-center justify-center gap-2"
            >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Accept quotation
            </button>
        </div>
    );
}
