import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Link2, Unlink, Send, CheckCircle2 } from 'lucide-react';
import {
  getWhatsAppStatus,
  linkWhatsApp,
  verifyWhatsApp,
  unlinkWhatsApp,
} from '../services/whatsappService';
import type { WhatsAppStatus } from '../services/whatsappService';

type LinkStep = 'idle' | 'enter-phone' | 'code-sent' | 'verifying';

const WhatsAppLinkSection: React.FC = () => {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkStep, setLinkStep] = useState<LinkStep>('idle');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const s = await getWhatsAppStatus();
      setStatus(s);
    } catch {
      setStatus({ linked: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) return;
    setError(null);
    setActionLoading(true);

    try {
      await linkWhatsApp(phoneNumber.trim());
      setLinkStep('code-sent');
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerify = async () => {
    if (verificationCode.length !== 6) return;
    setError(null);
    setActionLoading(true);
    setLinkStep('verifying');

    try {
      await verifyWhatsApp(verificationCode);
      await fetchStatus();
      setLinkStep('idle');
      setPhoneNumber('');
      setVerificationCode('');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setLinkStep('code-sent');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlink = async () => {
    setError(null);
    setActionLoading(true);

    try {
      await unlinkWhatsApp();
      setStatus({ linked: false });
    } catch (err: any) {
      setError(err.message || 'Failed to unlink');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = () => {
    setLinkStep('idle');
    setPhoneNumber('');
    setVerificationCode('');
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 size={14} className="animate-spin" />
        <span>Checking WhatsApp status...</span>
      </div>
    );
  }

  // Already linked
  if (status?.linked) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-100">WhatsApp Connected</p>
            <p className="text-xs text-gray-400">
              Send messages to the bot to save notes. Number: {status.whatsappNumber}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-md">
              <CheckCircle2 size={14} /> Linked
            </span>
            <button
              onClick={handleUnlink}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
              Unlink
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // Not linked — show linking flow
  return (
    <div className="space-y-3">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-100">WhatsApp Integration</p>
        <p className="text-xs text-gray-400">
          Link your WhatsApp to save notes by sending messages to the bot.
        </p>
      </div>

      {linkStep === 'idle' && (
        <button
          onClick={() => setLinkStep('enter-phone')}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 active:scale-95"
        >
          <Link2 size={14} /> Link WhatsApp
        </button>
      )}

      {linkStep === 'enter-phone' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              onClick={handleSendCode}
              disabled={actionLoading || !phoneNumber.trim()}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 active:scale-95 disabled:opacity-50 shrink-0"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send Code
            </button>
          </div>
          <p className="text-xs text-gray-500">Enter your WhatsApp number in international format (e.g., +14155238886)</p>
          <button onClick={handleCancel} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Cancel</button>
        </div>
      )}

      {(linkStep === 'code-sent' || linkStep === 'verifying') && (
        <div className="space-y-2">
          <p className="text-xs text-gray-300">A verification code has been sent to your WhatsApp. Enter it below:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors font-mono tracking-widest text-center"
            />
            <button
              onClick={handleVerify}
              disabled={actionLoading || verificationCode.length !== 6}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 active:scale-95 disabled:opacity-50 shrink-0"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Verify
            </button>
          </div>
          <button onClick={handleCancel} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Cancel</button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
};

export default WhatsAppLinkSection;
