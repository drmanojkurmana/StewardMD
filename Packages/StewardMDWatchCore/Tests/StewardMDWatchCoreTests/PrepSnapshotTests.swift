import Foundation
import Testing
@testable import StewardMDWatchCore

struct PrepSnapshotTests {
    @Test func decodesTheWebPayload() throws {
        let s = try #require(PrepSnapshot.decode(#"{"v":1,"score":62,"exam":"NEET-PG","daysLeft":41,"done":3,"total":7,"next":"Pharmacology MCQs","day":"2026-10-06","updated":1790000000000}"#))
        #expect(s.score == 62 && s.exam == "NEET-PG" && s.daysLeft == 41)
        #expect(s.done == 3 && s.total == 7 && s.next == "Pharmacology MCQs" && s.day == "2026-10-06")
    }

    @Test func clampsAndToleratesBadFields() throws {
        let s = try #require(PrepSnapshot.decode(#"{"score":140.4,"exam":"","daysLeft":null,"done":9,"total":4,"next":"  ","day":5}"#))
        #expect(s.score == 100 && s.exam == "Exam" && s.daysLeft == nil)
        #expect(s.done == 4 && s.total == 4 && s.next == nil && s.day == nil)
        #expect(PrepSnapshot.decode(#"{"score":true,"total":"x"}"#)?.score == nil)
    }

    @Test(arguments: [nil, "", "garbage", "[1,2]", #"{"v":2,"score":1}"#])
    func rejectsGarbage(_ json: String?) {
        #expect(PrepSnapshot.decode(json) == nil)
    }

    @Test func dayRollover() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = try #require(TimeZone(identifier: "Asia/Kolkata"))
        let noon = try #require(cal.date(from: DateComponents(year: 2026, month: 10, day: 6, hour: 12)))
        let s = PrepSnapshot(score: 1, exam: "X", daysLeft: 1, done: 0, total: 1, next: nil, day: "2026-10-06")
        #expect(s.isCurrent(on: noon, calendar: cal))
        let midnight = PrepSnapshot.endOfDay(after: noon, calendar: cal)
        #expect(!s.isCurrent(on: midnight, calendar: cal))
        #expect(midnight.timeIntervalSince(noon) == 12 * 3600)
    }
}
