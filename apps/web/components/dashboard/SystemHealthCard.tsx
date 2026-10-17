'use client';

import React, { useState, useEffect } from 'react';
import { Database, Server, Cpu, RefreshCw, CheckCircle2, AlertCircle, HardDrive } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface HealthData {
  status?: string;
  timestamp?: string;
  version?: string;
  checks?: {
    database?: { status?: string; latencyMs?: number; details?: { pgvectorInstalled?: boolean } };
    redis?: { status?: string; latencyMs?: number };
    aiService?: { status?: string; latencyMs?: number };
    storage?: { status?: string; latencyMs?: number; message?: string };
  };
}

export function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealth(data);
    } catch {
      setError('Health probe unreachable');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  const isHealthy = health?.status === 'healthy';

  return (
    <Card className="border-[#20242a] bg-[#14171b]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-[#f3f4f6]">
              Subsystem Health Diagnostics
            </CardTitle>
            <Badge variant={isHealthy ? 'success' : 'warning'} size="sm">
              {isHealthy ? 'Operational' : 'Diagnostic Check'}
            </Badge>
          </div>
          <CardDescription>
            Live backend connectivity for database, message broker, and neural services.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchHealth}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </Button>
      </CardHeader>

      <CardContent>
        {error ? (
          <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-[4px] text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {/* Database Check */}
            <div className="p-3.5 rounded-[4px] bg-[#111316] border border-[#20242a] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                  <Database className="w-3.5 h-3.5 text-[#c5a059]" />
                  <span>PostgreSQL + Vector</span>
                </div>
                {health?.checks?.database?.status === 'healthy' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2ec4b6]" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#e76f51]" />
                )}
              </div>
              <div className="text-[11px] text-[#6b7280] font-mono">
                {health?.checks?.database?.details?.pgvectorInstalled ? 'pgvector Enabled' : 'Status: ' + (health?.checks?.database?.status || 'Active')}
              </div>
            </div>

            {/* Redis Check */}
            <div className="p-3.5 rounded-[4px] bg-[#111316] border border-[#20242a] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                  <Server className="w-3.5 h-3.5 text-[#c5a059]" />
                  <span>Redis Broker</span>
                </div>
                {health?.checks?.redis?.status === 'healthy' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2ec4b6]" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#e76f51]" />
                )}
              </div>
              <div className="text-[11px] text-[#6b7280] font-mono">
                {health?.checks?.redis?.status || 'In-Memory Fallback'}
              </div>
            </div>

            {/* AI Service Check */}
            <div className="p-3.5 rounded-[4px] bg-[#111316] border border-[#20242a] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                  <Cpu className="w-3.5 h-3.5 text-[#c5a059]" />
                  <span>Neural Biometrics</span>
                </div>
                {health?.checks?.aiService?.status === 'healthy' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2ec4b6]" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#9ca3af]" />
                )}
              </div>
              <div className="text-[11px] text-[#6b7280] font-mono">
                YuNet + SFace (v1)
              </div>
            </div>

            {/* Cloudflare R2 Storage Check */}
            <div className="p-3.5 rounded-[4px] bg-[#111316] border border-[#20242a] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                  <HardDrive className="w-3.5 h-3.5 text-[#c5a059]" />
                  <span>Cloudflare R2</span>
                </div>
                {health?.checks?.storage?.status === 'healthy' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#2ec4b6]" />
                ) : health?.checks?.storage?.status === 'disabled' ? (
                  <span className="w-2 h-2 rounded-full bg-[#9ca3af]" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[#e76f51]" />
                )}
              </div>
              <div className="text-[11px] text-[#6b7280] font-mono truncate">
                {health?.checks?.storage?.status === 'healthy'
                  ? 'Connected ($0 Egress)'
                  : health?.checks?.storage?.status === 'disabled'
                  ? 'Local Dev (Unset)'
                  : 'Check Credentials'}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
