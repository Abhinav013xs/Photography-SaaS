'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Copy,
  Check,
  Download,
  ExternalLink,
  QrCode,
  Shield,
  Printer,
  Globe,
  Lock,
  AlertTriangle,
  FileCode,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { EventDetail, EventQrShareDTO } from '@photography-saas/types';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: EventDetail;
}

function sanitizeFilename(name: string, ext: 'png' | 'svg'): string {
  const rawClean = (name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');
  const hasAlphanumeric = /[a-zA-Z0-9]/.test(rawClean);
  return `${hasAlphanumeric ? rawClean : 'Event'}_QR.${ext}`;
}

export function ShareModal({ isOpen, onClose, event }: ShareModalProps) {
  const [qrData, setQrData] = useState<EventQrShareDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFallbackNotice, setCopyFallbackNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadQr() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/${event.id}/qr`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || json.error || 'Failed to generate QR code');
        }
        if (isMounted) {
          setQrData(json.data || json);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to generate QR code');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadQr();

    return () => {
      isMounted = false;
    };
  }, [isOpen, event.id]);

  const handleCopy = async () => {
    if (!qrData?.shareUrl) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(qrData.shareUrl);
        setCopied(true);
        setCopyFallbackNotice(null);
        setTimeout(() => setCopied(false), 2000);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    if (inputRef.current) {
      inputRef.current.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          setCopied(true);
          setCopyFallbackNotice(null);
          setTimeout(() => setCopied(false), 2000);
        } else {
          setCopyFallbackNotice('Link selected. Press Ctrl+C to copy.');
        }
      } catch {
        setCopyFallbackNotice('Link selected. Press Ctrl+C to copy.');
      }
    }
  };

  const handleDownloadPng = () => {
    if (!qrData?.qrDataUrl) return;
    const filename = sanitizeFilename(event.name, 'png');
    const a = document.createElement('a');
    a.href = qrData.qrDataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadSvg = () => {
    if (!qrData?.qrSvg) return;
    const filename = sanitizeFilename(event.name, 'svg');
    const blob = new Blob([qrData.qrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const isExpired = qrData?.isExpired ?? event.is_expired;
  const isPrivate = (qrData?.visibility || event.visibility) === 'private';
  const pinProtected = Boolean(qrData?.pinProtected ?? event.pin_enabled);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Event Share & QR Code"
        description="Shareable canonical link and print-ready QR codes for guests"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 text-center">
          {/* Header Info */}
          <div>
            <h3 className="font-serif text-xl font-semibold text-white tracking-wide">
              {event.name}
            </h3>
            <p className="text-xs text-[#9ca3af] mt-0.5">
              Client: {event.client_name} • {event.event_date}
            </p>
          </div>

          {/* Access State Banner */}
          <div
            className={`p-2.5 rounded-md text-xs flex items-center gap-2 text-left leading-relaxed ${
              isExpired
                ? 'bg-[#e76f51]/10 border border-[#e76f51]/30 text-[#e76f51]'
                : isPrivate
                ? 'bg-[#6b7280]/10 border border-[#6b7280]/30 text-[#9ca3af]'
                : pinProtected
                ? 'bg-[#c5a059]/10 border border-[#c5a059]/30 text-[#e2c17c]'
                : 'bg-[#2ec4b6]/10 border border-[#2ec4b6]/30 text-[#2ec4b6]'
            }`}
          >
            {isExpired ? (
              <>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Gallery Expired</strong> — Public access has ended. Republish the event in settings to restore access.
                </span>
              </>
            ) : isPrivate ? (
              <>
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Private Gallery</strong> — Guests cannot view photos until gallery visibility is set to Public.
                </span>
              </>
            ) : pinProtected ? (
              <>
                <Shield className="w-4 h-4 shrink-0 text-[#c5a059]" />
                <span>
                  <strong>PIN Protected</strong> — Guests must enter the PIN to unlock photos. (The PIN is never embedded in the QR or link).
                </span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Public Access</strong> — Anyone with this link or QR code can view event photos.
                </span>
              </>
            )}
          </div>

          {/* QR Code Container */}
          <div className="flex justify-center">
            <div className="p-3.5 bg-white rounded-md border border-[#2c323b] shadow-md inline-block">
              {loading ? (
                <div className="w-[200px] h-[200px] flex items-center justify-center text-xs text-[#555]">
                  Generating QR code...
                </div>
              ) : error ? (
                <div className="w-[200px] h-[200px] flex flex-col items-center justify-center text-xs text-[#e63946] p-2 text-center">
                  <AlertTriangle className="w-6 h-6 mb-1 text-[#e63946]" />
                  <span>{error}</span>
                </div>
              ) : qrData?.qrDataUrl ? (
                <img
                  src={qrData.qrDataUrl}
                  alt="Event QR Code"
                  className="w-[200px] h-[200px] block"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center text-xs text-[#555]">
                  QR code unavailable
                </div>
              )}
            </div>
          </div>

          {/* Share Link Box with Input and Copy */}
          <div className="flex items-center gap-2 p-1.5 pl-3 bg-[#121418] border border-[#20242a] rounded-md">
            <input
              ref={inputRef}
              type="text"
              readOnly
              value={qrData?.shareUrl || ''}
              placeholder="Generating link..."
              className="w-full bg-transparent border-none outline-hidden text-xs text-[#f3f4f6] font-mono cursor-text"
              onFocus={(e) => e.target.select()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!qrData?.shareUrl}
              leftIcon={copied ? <Check className="w-3.5 h-3.5 text-[#2ec4b6]" /> : <Copy className="w-3.5 h-3.5" />}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>

          {copyFallbackNotice && (
            <p className="text-[11px] text-[#e76f51]">{copyFallbackNotice}</p>
          )}

          {/* Actions Strip */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#20242a]">
            {qrData?.shareUrl ? (
              <a
                href={qrData.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#9ca3af] hover:text-[#c5a059] flex items-center gap-1 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Preview Gallery</span>
              </a>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!qrData?.qrDataUrl}
                leftIcon={<Printer className="w-3.5 h-3.5" />}
              >
                Print Sign
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadSvg}
                disabled={!qrData?.qrSvg}
                leftIcon={<FileCode className="w-3.5 h-3.5" />}
              >
                SVG
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={handleDownloadPng}
                disabled={!qrData?.qrDataUrl}
                leftIcon={<Download className="w-3.5 h-3.5" />}
              >
                PNG
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Dedicated Print-Friendly Card (Rendered only on window.print()) */}
      <div className="hidden print:block fixed inset-0 z-50 bg-white p-8 text-black text-center">
        <div className="max-w-md mx-auto border-2 border-black p-8 rounded-lg">
          <div className="border-b-2 border-black pb-3 mb-6">
            <span className="text-[11px] uppercase tracking-widest text-gray-600 font-semibold">
              Studio Lumina • Guest Gallery
            </span>
            <h1 className="text-3xl font-serif font-bold text-black mt-2 mb-1">
              {event.name}
            </h1>
            <p className="text-xs text-gray-600">
              {event.client_name ? `Honoring ${event.client_name}` : ''} {event.event_date ? `• ${event.event_date}` : ''}
            </p>
          </div>

          {qrData?.qrDataUrl && (
            <div className="my-6 inline-block">
              <img
                src={qrData.qrDataUrl}
                alt="Event QR Code"
                className="w-64 h-64 mx-auto block"
              />
            </div>
          )}

          <div className="mt-4 space-y-2">
            <p className="text-base font-semibold text-black">
              Scan to view your event photos
            </p>
            <p className="text-xs text-gray-600">
              Point your smartphone camera at the code above or visit:
            </p>
            <p className="text-xs font-mono bg-gray-100 p-2 rounded-sm border border-gray-300 inline-block text-black">
              {qrData?.shareUrl}
            </p>

            {pinProtected && (
              <p className="text-xs text-gray-700 italic pt-2">
                Note: An event PIN is required to access this gallery.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
