'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Shield,
  Layers,
  Sparkles,
  HardDrive,
  ArrowRight,
  Plus,
  Lock,
  Clock,
} from 'lucide-react';
import { useAuthSession } from '../../lib/auth';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SystemHealthCard } from '../../components/dashboard/SystemHealthCard';
import type { EventListItem } from '@photography-saas/types';

export default function DashboardPage() {
  const { photographer } = useAuthSession();
  const [recentEvents, setRecentEvents] = useState<EventListItem[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  useEffect(() => {
    async function loadRecent() {
      try {
        const res = await fetch('/api/events?limit=3', { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.events) {
            setRecentEvents(json.data.events);
          }
        }
      } catch {
        // Silently handle network errors
      } finally {
        setIsLoadingEvents(false);
      }
    }
    loadRecent();
  }, []);

  if (!photographer) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Page Header */}
      <PageHeader
        eyebrow="Sole Owner Workspace"
        title={photographer.businessName}
        description={`Welcome back. You are authenticated as ${photographer.email}. Manage your photography events, client delivery, and neural face-search capabilities.`}
        actions={
          <div className="flex items-center gap-3">
            <Link href="/dashboard/events/new">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Create Event
              </Button>
            </Link>
          </div>
        }
      />

      {/* Architecture Foundations Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pillar 1: Single Owner Security */}
        <Card className="hover:border-[#2c323b] transition-colors">
          <CardHeader className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <Shield className="w-4 h-4 text-[#c5a059]" />
              <Badge variant="success" size="sm">Phase 4 Active</Badge>
            </div>
            <CardTitle className="text-sm font-medium pt-1">
              Security Boundary
            </CardTitle>
            <CardDescription className="text-[11px] leading-relaxed">
              Salted bcrypt hashing, HttpOnly session cookie, and brute-force rate limiter.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Pillar 2: Event Isolation */}
        <Card className="hover:border-[#2c323b] transition-colors">
          <CardHeader className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <Layers className="w-4 h-4 text-[#c5a059]" />
              <Badge variant="success" size="sm">Phase 6 Active</Badge>
            </div>
            <CardTitle className="text-sm font-medium pt-1">
              Event Management
            </CardTitle>
            <CardDescription className="text-[11px] leading-relaxed">
              Independent client event containers, safe defaults, 30-day public limit, and PIN gates.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Pillar 3: AI Neural Embeddings */}
        <Card className="hover:border-[#2c323b] transition-colors">
          <CardHeader className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <Sparkles className="w-4 h-4 text-[#c5a059]" />
              <Badge variant="default" size="sm">Phase 14–16</Badge>
            </div>
            <CardTitle className="text-sm font-medium pt-1">
              AI Face Search
            </CardTitle>
            <CardDescription className="text-[11px] leading-relaxed">
              YuNet multi-face detection + 128-D SFace embeddings with ephemeral zero-retention.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Pillar 4: Cloudflare R2 Storage */}
        <Card className="hover:border-[#2c323b] transition-colors">
          <CardHeader className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <HardDrive className="w-4 h-4 text-[#c5a059]" />
              <Badge variant="default" size="sm">Phase 8–9</Badge>
            </div>
            <CardTitle className="text-sm font-medium pt-1">
              Cloudflare R2 Storage
            </CardTitle>
            <CardDescription className="text-[11px] leading-relaxed">
              Direct photographer ownership with zero egress fees and signed media delivery.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Events Workspace Section with Real Events or Polished Empty State */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-[#20242a] pb-3">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-4 h-4 text-[#c5a059]" />
            <h2 className="text-base font-medium text-[#f3f4f6]">
              Client Events & Galleries
            </h2>
          </div>
          <Link
            href="/dashboard/events"
            className="text-xs text-[#9ca3af] hover:text-[#c5a059] flex items-center gap-1 transition-colors"
          >
            <span>View All Events ({recentEvents.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentEvents.length === 0 ? (
          <EmptyState
            badge="Phase 6 Activated"
            title="No events created yet"
            description="Your studio does not have any active client event containers yet. Create your first event to establish gallery privacy, PIN protection, and ceremony workflows."
            action={
              <Link href="/dashboard/events/new">
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-2"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Create First Event
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentEvents.map((event) => (
              <Card key={event.id} className="hover:border-[#2c323b] transition-all">
                <CardHeader className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={
                        event.status === 'active'
                          ? 'success'
                          : event.status === 'draft'
                          ? 'warning'
                          : 'default'
                      }
                      size="sm"
                    >
                      {event.status.toUpperCase()}
                    </Badge>
                    <span className="text-[11px] text-[#9ca3af] font-mono">
                      {event.event_date}
                    </span>
                  </div>
                  <Link href={`/dashboard/events/${event.id}`}>
                    <CardTitle className="text-sm font-serif text-white hover:text-[#c5a059] transition-colors truncate">
                      {event.name}
                    </CardTitle>
                  </Link>
                  <CardDescription className="text-xs text-[#9ca3af] truncate">
                    {event.client_name}{event.location ? ` • ${event.location}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 py-2.5 border-t border-[#20242a] flex items-center justify-between text-xs bg-[#0d0e12]/40">
                  <span className="text-[11px] text-[#9ca3af]">
                    {event.visibility === 'public' ? 'Public Gallery' : 'Private'}
                  </span>
                  <Link
                    href={`/dashboard/events/${event.id}`}
                    className="text-xs text-[#c5a059] hover:underline"
                  >
                    Open &rarr;
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Real Subsystem Health Status Monitor */}
      <SystemHealthCard />
    </div>
  );
}
