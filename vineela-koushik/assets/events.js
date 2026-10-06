/* Event information: the single source of truth for dates, venues, links and calendar files.
   Times are stored with their India offset (+05:30) so countdowns and calendar entries are
   correct for guests in any timezone. */
(function () {
  "use strict";
  var VK = (window.VK = window.VK || {});

  VK.page = {
    url: "https://stewardmd.in/vineela-koushik/",
    shareTitle: "Vineela weds Koushik",
    shareText: "Vineela weds Koushik. Sumuhurtham Thu 5 Nov 2026, 9:41 pm, Ramachandrapuram, Mangalagiri. Reception Sat 7 Nov 2026, 7 pm, P.S.R. Convention, Kompally, Hyderabad."
  };

  /* Optional: path to a licensed instrumental track (mp3/m4a). When set, it replaces the
     generated raga soundtrack. Example: "assets/audio/soundtrack.m4a" */
  VK.soundtrackUrl = null;

  VK.events = {
    wedding: {
      key: "wedding",
      label: "Sumuhurtham",
      title: "Vineela & Koushik: Wedding (Sumuhurtham 9:41 pm, Midhuna Lagnam)",
      start: "2026-11-05T21:41:00+05:30",
      end: "2026-11-05T23:41:00+05:30",
      when: "Thursday, 5 November 2026, 9:41 pm",
      location: "Bride's Residence, Ramachandrapuram Village, Mangalagiri Mandal, Guntur Dist.",
      mapsQuery: "Ramachandrapuram, Mangalagiri Mandal, Guntur District, Andhra Pradesh",
      file: "vineela-koushik-wedding.ics"
    },
    reception: {
      key: "reception",
      label: "Reception",
      title: "Vineela & Koushik: Reception",
      start: "2026-11-07T19:00:00+05:30",
      end: "2026-11-07T22:30:00+05:30",
      when: "Saturday, 7 November 2026, from 7:00 pm",
      location: "P.S.R. Convention, Kompally, Hyderabad",
      mapsQuery: "P.S.R. Convention, Kompally, Hyderabad",
      file: "vineela-koushik-reception.ics"
    }
  };

  VK.muhurthamAt = Date.parse(VK.events.wedding.start);

  function utcStamp(iso) {
    return new Date(Date.parse(iso)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  function icsEscape(t) {
    return String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  VK.links = {
    maps: function (ev) {
      return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ev.mapsQuery);
    },
    google: function (ev) {
      return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=" + encodeURIComponent(ev.title) +
        "&dates=" + utcStamp(ev.start) + "/" + utcStamp(ev.end) +
        "&ctz=Asia%2FKolkata" +
        "&location=" + encodeURIComponent(ev.location) +
        "&details=" + encodeURIComponent("Invitation: " + VK.page.url);
    },
    ics: function (ev) {
      var lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kurre family//Wedding invitation//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:" + ev.key + "-vineela-koushik-2026@stewardmd.in",
        "DTSTAMP:" + utcStamp(new Date().toISOString()),
        "DTSTART:" + utcStamp(ev.start),
        "DTEND:" + utcStamp(ev.end),
        "SUMMARY:" + icsEscape(ev.title),
        "LOCATION:" + icsEscape(ev.location),
        "DESCRIPTION:" + icsEscape("Invitation: " + VK.page.url),
        "URL:" + VK.page.url,
        "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(ev.title), "END:VALARM",
        "END:VEVENT", "END:VCALENDAR"
      ];
      return lines.join("\r\n") + "\r\n";
    }
  };
})();
