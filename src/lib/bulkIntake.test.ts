import { describe, expect, it } from "vitest";
import {
  parseHandicapIntake,
  parsePaymentIntake,
  parseScheduleIntake,
  parseUnifiedBlockerIntake,
} from "./bulkIntake";
import type { Buyin, Player, Tournament } from "./types";

const player = (name: string, member = true): Player => ({
  name,
  handicap: null,
  member,
  updatedAt: "2026-01-01",
});

const buyin = (playerName: string, amount = 325): Buyin => ({
  playerName,
  amount,
  paid: false,
  paidAt: null,
  notes: null,
  updatedAt: "2026-01-01",
});

const tournament = (
  id: string,
  name: string,
  course = "TBD"
): Tournament => ({
  id,
  name,
  course,
  windowStart: "2026-07-01",
  windowEnd: "2026-07-01",
  type: "major",
  pointsToFirst: null,
  payoutFirst: null,
  payoutSecond: null,
  payoutThird: null,
  notes: "TBD.",
  createdAt: "2026-01-01",
});

describe("bulk intake parsers", () => {
  it("matches known member names and handicap indexes from pasted lines", () => {
    expect(
      parseHandicapIntake(
        ["Beck: 8.2", "Chris GHIN 11.4", "Drop In 7.1", "Unknown 4.2"].join(
          "\n"
        ),
        [player("Beck"), player("Chris"), player("Drop In", false)]
      )
    ).toEqual([
      { name: "Beck", handicap: 8.2, ghinNumber: null, source: "Beck: 8.2" },
      { name: "Chris", handicap: 11.4, ghinNumber: null, source: "Chris GHIN 11.4" },
    ]);
  });

  it("stores GHIN number separately when a line includes number and index", () => {
    expect(
      parseHandicapIntake(
        "Chris GHIN 1234567 index 11.4\nBeck GHIN #7654321 H.I. 8.2",
        [player("Chris"), player("Beck")]
      )
    ).toEqual([
      {
        name: "Chris",
        handicap: 11.4,
        ghinNumber: "1234567",
        source: "Chris GHIN 1234567 index 11.4",
      },
      {
        name: "Beck",
        handicap: 8.2,
        ghinNumber: "7654321",
        source: "Beck GHIN #7654321 H.I. 8.2",
      },
    ]);
  });

  it("keeps the latest pasted value for a repeated handicap name", () => {
    expect(
      parseHandicapIntake("Beck 8.2\nBeck 8.5", [player("Beck")])
    ).toEqual([{ name: "Beck", handicap: 8.5, ghinNumber: null, source: "Beck 8.5" }]);
  });

  it("matches buy-in payment lines with explicit amount and note", () => {
    expect(
      parsePaymentIntake(
        "Beck paid cash $325 2026-05-19\nChris paid venmo $300 2026-05-20\nRyan 325",
        [buyin("Beck"), buyin("Chris"), buyin("Ryan")]
      )
    ).toEqual([
      {
        name: "Beck",
        amount: 325,
        paymentStatus: "paid",
        paymentMethod: "cash",
        paidAt: "2026-05-19",
        note: "Beck paid cash $325 2026-05-19",
        source: "Beck paid cash $325 2026-05-19",
      },
      {
        name: "Chris",
        amount: 300,
        paymentStatus: "paid",
        paymentMethod: "venmo",
        paidAt: "2026-05-20",
        note: "Chris paid venmo $300 2026-05-20",
        source: "Chris paid venmo $300 2026-05-20",
      },
    ]);
  });

  it("does not mark payment chatter without explicit evidence as paid", () => {
    expect(
      parsePaymentIntake("Beck paid cash\nChris paid venmo\nRyan paid cash $325", [
        buyin("Beck"),
        buyin("Chris"),
        buyin("Ryan"),
      ])
    ).toEqual([]);
  });

  it("does not mistake GHIN values or owed-status lines for payment amounts", () => {
    expect(
      parsePaymentIntake(
        "Chris GHIN 11.4 paid\nBeck not paid, GHIN 8.2\nRyan still owes $325",
        [buyin("Chris"), buyin("Beck"), buyin("Ryan")]
      )
    ).toEqual([]);
  });

  it("keeps future-payment promises out of paid intake matches", () => {
    expect(
      parsePaymentIntake(
        "Beck can pay Friday\nChris will Venmo tomorrow\nRyan will Venmo $325 2026-05-19",
        [
        buyin("Beck"),
        buyin("Chris"),
        buyin("Ryan"),
        ]
      )
    ).toEqual([
      {
        name: "Beck",
        amount: 325,
        paymentStatus: "promised",
        paymentMethod: null,
        paidAt: null,
        note: "Beck can pay Friday",
        source: "Beck can pay Friday",
      },
      {
        name: "Chris",
        amount: 325,
        paymentStatus: "promised",
        paymentMethod: "venmo",
        paidAt: null,
        note: "Chris will Venmo tomorrow",
        source: "Chris will Venmo tomorrow",
      },
      {
        name: "Ryan",
        amount: 325,
        paymentStatus: "promised",
        paymentMethod: "venmo",
        paidAt: null,
        note: "Ryan will Venmo $325 2026-05-19",
        source: "Ryan will Venmo $325 2026-05-19",
      },
    ]);
  });

  it("requires dated evidence for comped, refunded, and disputed intake", () => {
    expect(
      parsePaymentIntake(
        [
          "Beck comped",
          "Chris comped 2026-05-19",
          "Ryan refunded $325",
          "Will disputed $325 2026-05-20",
        ].join("\n"),
        [buyin("Beck"), buyin("Chris"), buyin("Ryan"), buyin("Will")]
      )
    ).toEqual([
      {
        name: "Chris",
        amount: 325,
        paymentStatus: "comped",
        paymentMethod: "comp",
        paidAt: "2026-05-19",
        note: "Chris comped 2026-05-19",
        source: "Chris comped 2026-05-19",
      },
      {
        name: "Will",
        amount: 325,
        paymentStatus: "disputed",
        paymentMethod: null,
        paidAt: "2026-05-20",
        note: "Will disputed $325 2026-05-20",
        source: "Will disputed $325 2026-05-20",
      },
    ]);
  });

  it("matches known tournament schedule lines with dates and notes", () => {
    expect(
      parseScheduleIntake(
        [
          "Mid-season major: CommonGround Golf Course, 2026-07-18, shotgun",
          "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
          "Unknown event: Anywhere, 2026-09-01",
        ].join("\n"),
        [
          tournament("major", "Mid-season major"),
          tournament("post", "Championship — 2-day post-season"),
        ]
      )
    ).toEqual([
      {
        id: "major",
        name: "Mid-season major",
        course: "CommonGround Golf Course",
        windowStart: "2026-07-18",
        windowEnd: "2026-07-18",
        notes: "shotgun",
        source: "Mid-season major: CommonGround Golf Course, 2026-07-18, shotgun",
      },
      {
        id: "post",
        name: "Championship — 2-day post-season",
        course: "Fossil Trace",
        windowStart: "2026-10-10",
        windowEnd: "2026-10-11",
        notes: "finals",
        source:
          "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
      },
    ]);
  });

  it("splits one mixed commissioner paste into payments, GHINs, and schedule", () => {
    expect(
      parseUnifiedBlockerIntake(
        [
          "Beck paid cash $325 2026-05-19",
          "Chris GHIN 11.4 paid",
          "Ryan 12.8",
          "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
        ].join("\n"),
        {
          players: [player("Beck"), player("Chris"), player("Ryan")],
          buyins: [buyin("Beck"), buyin("Chris"), buyin("Ryan")],
          tournaments: [tournament("post", "Championship — 2-day post-season")],
        }
      )
    ).toEqual({
      payments: [
        {
          name: "Beck",
          amount: 325,
          paymentStatus: "paid",
          paymentMethod: "cash",
          paidAt: "2026-05-19",
          note: "Beck paid cash $325 2026-05-19",
          source: "Beck paid cash $325 2026-05-19",
        },
      ],
      handicaps: [
        { name: "Chris", handicap: 11.4, ghinNumber: null, source: "Chris GHIN 11.4 paid" },
        { name: "Ryan", handicap: 12.8, ghinNumber: null, source: "Ryan 12.8" },
      ],
      schedules: [
        {
          id: "post",
          name: "Championship — 2-day post-season",
          course: "Fossil Trace",
          windowStart: "2026-10-10",
          windowEnd: "2026-10-11",
          notes: "finals",
          source:
            "Championship — 2-day post-season: Fossil Trace, 2026-10-10 to 2026-10-11, finals",
        },
      ],
    });
  });
});
