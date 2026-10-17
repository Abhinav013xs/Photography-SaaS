'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Plus,
  Search,
  Globe,
  Lock,
  Archive,
  RefreshCw,
  ExternalLink,
  Clock,
  Download,
  AlertCircle,
  Eye,
  CheckCircle,
} from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { SkeletonCard } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import type { EventListItem, EventStatus } from '@photography-saas/types';

export default function EventsWorkspacePage() {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/events?${params.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to load events');
      }

      const json = await res.json();
      if (json.success && json.data?.events) {
        setEvents(json.data.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error communicating with events service');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvents();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchEvents]);

  // Counts for tabs
  const draftCount = events.filter((e) => e.status === 'draft').length;
  const activeCount = events.filter((e) => e.status === 'active').length;
  const archivedCount = events.filter((e) => e.status === 'archived').length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Events Domain"
        title="Events Workspace"
        description="Comprehensive management of independent client event containers, ceremonies, and gallery visibility."
        actions={
          <Link href="/dashboard/events/new">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Create Event
            </Button>
          </Link>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#121418] border border-[#20242a] rounded-lg">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-[#20242a] text-white'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            All Events ({events.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'active'
                ? 'bg-[#20242a] text-white'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'draft'
                ? 'bg-[#20242a] text-white'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            Draft ({draftCount})
          </button>
          <button
            onClick={() => setStatusFilter('archived')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === 'archived'
                ? 'bg-[#20242a] text-white'
                : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            Archived ({archivedCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#9ca3af] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search events, clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs pl-8 pr-3 py-1.5 rounded-md outline-none transition-colors"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <ErrorState
          title="Error Loading Events"
          message={error}
          onRetry={fetchEvents}
        />
      ) : events.length === 0 ? (
        searchQuery ? (
          <EmptyState
            icon={<Search className="w-6 h-6 stroke-[1.5]" />}
            title="No matching events found"
            description={`No events match your search query "${searchQuery}".`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery('')}
              >
                Clear Search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Calendar className="w-6 h-6 stroke-[1.5]" />}
            badge="Phase 6 Activated"
            title="No client events created yet"
            description="Create your first client event container to establish safe gallery privacy, PIN protection, and ceremony workflows."
            action={
              <Link href="/dashboard/events/new">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                  className="mt-2"
                >
                  Create Your First Event
                </Button>
              </Link>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
            <Card
              key={event.id}
              className="group hover:border-[#2c323b] transition-all flex flex-col justify-between"
            >
              <CardHeader className="p-5 pb-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
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
                    <Badge
                      variant={
                        event.visibility === 'public'
                          ? event.is_expired
                            ? 'destructive'
                            : 'bronze'
                          : 'outline'
                      }
                      size="sm"
                    >
                      {event.visibility === 'public'
                        ? event.is_expired
                          ? 'EXPIRED'
                          : 'PUBLIC'
                        : 'PRIVATE'}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-[#9ca3af] font-mono">
                    {event.event_date}
                  </span>
                </div>

                <div className="space-y-1">
                  <Link
                    href={`/dashboard/events/${event.id}`}
                    className="block group-hover:text-[#c5a059] transition-colors"
                  >
                    <CardTitle className="text-base font-serif tracking-wide text-white line-clamp-1">
                      {event.name}
                    </CardTitle>
                  </Link>
                  <CardDescription className="text-xs text-[#9ca3af] line-clamp-1">
                    Client: {event.client_name}
                    {event.location ? ` • ${event.location}` : ''}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="px-5 py-3 border-t border-[#20242a] space-y-3 bg-[#0d0e12]/50">
                {/* Feature Pills */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9ca3af]">
                  {event.pin_enabled ? (
                    <span className="flex items-center gap-1 text-[#c5a059]">
                      <Lock className="w-3 h-3" />
                      PIN Protected
                    </span>
                  ) : (
                    <span className="text-[#6b7280]">Open Access</span>
                  )}

                  <span>•</span>

                  {event.allow_downloads ? (
                    <span className="text-white">Downloads On</span>
                  ) : (
                    <span className="text-[#6b7280]">Downloads Off</span>
                  )}

                  {event.visibility === 'public' && event.public_until && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-[#9ca3af]">
                        <Clock className="w-3 h-3" />
                        Until {new Date(event.public_until).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-1">
                  <Link
                    href={`/dashboard/events/${event.id}`}
                    className="text-xs text-[#c5a059] hover:text-[#b38f49] font-medium flex items-center gap-1"
                  >
                    Open Workspace &rarr;
                  </Link>

                  <div className="flex items-center gap-2">
                    <Link href={`/dashboard/events/${event.id}/edit`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        Edit
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
