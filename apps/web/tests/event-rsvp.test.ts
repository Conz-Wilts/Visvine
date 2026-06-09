import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  spotsTaken,
  occupiedSpots,
  decideRsvpStatus,
  makeICS,
} from "../lib/eventUtils";
import type { NBAttendee, NBEvent } from "../lib/types";

function attendee(partial: Partial<NBAttendee>): NBAttendee {
  return {
    id: "attendee:x" as `attendee:${string}`,
    eventId: "event:x" as `event:${string}`,
    personId: "",
    status: "going",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...partial,
  };
}

test("normalizeStatus maps legacy 'registered' to 'going'", () => {
  assert.equal(normalizeStatus("registered"), "going");
  assert.equal(normalizeStatus(undefined), "going");
  assert.equal(normalizeStatus(""), "going");
  assert.equal(normalizeStatus("waitlisted"), "waitlisted");
  assert.equal(normalizeStatus("checked_in"), "checked_in");
});

test("spotsTaken counts a confirmed guest plus their +guests", () => {
  assert.equal(spotsTaken(attendee({ status: "going", plusOnes: 2 })), 3);
  assert.equal(spotsTaken(attendee({ status: "checked_in", plusOnes: 0 })), 1);
  assert.equal(spotsTaken(attendee({ status: "registered" })), 1); // legacy
});

test("spotsTaken reserves nothing for maybe / waitlist / pending / cancelled", () => {
  assert.equal(spotsTaken(attendee({ status: "going", response: "maybe", plusOnes: 3 })), 0);
  assert.equal(spotsTaken(attendee({ status: "waitlisted", plusOnes: 1 })), 0);
  assert.equal(spotsTaken(attendee({ status: "pending" })), 0);
  assert.equal(spotsTaken(attendee({ status: "cancelled" })), 0);
});

test("occupiedSpots sums confirmed parties only", () => {
  const list = [
    attendee({ status: "going", plusOnes: 1 }), // 2
    attendee({ status: "going", response: "maybe" }), // 0
    attendee({ status: "waitlisted" }), // 0
    attendee({ status: "checked_in" }), // 1
  ];
  assert.equal(occupiedSpots(list), 3);
});

test("decideRsvpStatus respects response, approval and capacity", () => {
  assert.equal(decideRsvpStatus("declined", 1, { occupied: 0 }), "cancelled");
  assert.equal(decideRsvpStatus("maybe", 1, { occupied: 0 }), "going");
  assert.equal(decideRsvpStatus("going", 1, { occupied: 0, requireApproval: true }), "pending");
  assert.equal(decideRsvpStatus("going", 1, { occupied: 5, capacity: 5 }), "waitlisted");
  assert.equal(decideRsvpStatus("going", 1, { occupied: 4, capacity: 5 }), "going");
  // a party that would exceed capacity goes to the waitlist as a whole
  assert.equal(decideRsvpStatus("going", 2, { occupied: 4, capacity: 5 }), "waitlisted");
  // an already-confirmed guest editing their RSVP keeps their seat even when full
  assert.equal(
    decideRsvpStatus("going", 1, { occupied: 5, capacity: 5, isExistingConfirmed: true }),
    "going",
  );
});

test("makeICS produces a valid VEVENT with the event details", () => {
  const event = {
    id: "event:summer-mixer" as `event:${string}`,
    title: "Summer Mixer",
    description: "Drinks & networking",
    startAt: "2026-06-20T18:00:00.000Z",
    endAt: "2026-06-20T20:00:00.000Z",
    location: { label: "The Rooftop" },
  } as NBEvent;

  const ics = makeICS(event);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:Summer Mixer/);
  assert.match(ics, /LOCATION:The Rooftop/);
  assert.match(ics, /DTSTART:20260620T180000Z/);
  assert.match(ics, /END:VCALENDAR/);
});
