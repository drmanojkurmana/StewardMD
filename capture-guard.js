/* StewardMD: screen-capture guard for realistic lesson images.
 *
 * "Realistic lesson images" are <img> whose src contains /learn/media/real/ (Tokós today,
 * Ophthalmós later: the path segment is matched, not the module). They already carry a baked-in
 * StewardMD badge; this adds protection only while someone is capturing the screen.
 *
 *  - iOS: the CaptureGuard plugin reports recording / mirroring as captureChange. While captured,
 *    <html> gets .smd-cg-on and every image's container shows a tiled diagonal StewardMD mark
 *    (pointer-events:none, so hotspots and zoom still work). Normal viewing stays clean.
 *  - iOS: after any screenshot taken in the app (owner 2026-10-01), a calm notice appears through the
 *    app's shared toast (toast.js), in English or Hindi. (Android blocks the screenshot instead.)
 *  - Android: FLAG_SECURE is set through setSecure(true) while such an image is on screen and
 *    cleared as soon as none is, so questions and notes stay screenshot-able.
 *  - Web / PWA (no plugin): nothing is installed; fails silently.
 *
 * Containers are marked with data-smd-cg ("s" when they were position:static, so the capture CSS
 * can give them position:relative; "p" otherwise). An <img> cannot carry ::after, so the mark is
 * drawn on the parent. Exposed as window.SMD_CaptureGuard for tests. */
(function () {
  "use strict";
  var W = window, D = document;
  if (W.SMD_CaptureGuard) return;

  var REAL = /\/learn\/media\/real\//;
  var ATTR = "data-smd-cg";
  var ON = "smd-cg-on";
  var MSG = {
    en: "Images are ©\u00a0StewardMD. Please do not share.",
    hi: "ये चित्र ©\u00a0StewardMD के हैं। कृपया इन्हें साझा न करें।"
  };
  // 220x132 SVG tile: logo on a white disc + "StewardMD", rotated -28deg (built from logo.png).
  var TILE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMjAiIGhlaWdodD0iMTMyIiB2aWV3Qm94PSIwIDAgMjIwIDEzMiI+PGcgdHJhbnNmb3JtPSJyb3RhdGUoLTI4IDExMCA2NikiPjxjaXJjbGUgY3g9IjU4IiBjeT0iNjYiIHI9IjEzLjUiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjkyIi8+PGltYWdlIGhyZWY9ImRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCxpVkJPUncwS0dnb0FBQUFOU1VoRVVnQUFBRHdBQUFBOENBWUFBQUE2L05seUFBQUJZMmxEUTFCclEwZERiMnh2Y2xOd1lXTmxSR2x6Y0d4aGVWQXpBQUFva1gyUXNVdkRVQkRHdjFhbG9IVVFIUndjTW9sRGxKSUt1amkwRlVSeENGWEI2cFMrcHFtUXhrZVNJZ1UzLzRHQy80RUt6bTRXaHpvNk9BaWlrK2ptNUtUZ291VjVMNG1rSW5xUDQzNTg3N3ZqT0NBNWJuQnU5d09vTzc1YlhNb3JtNlV0SmZXTUJMMGdET2J4bks2dlN2NnVQK1A5UHZUZVRzdFp2Ly8vamNHSzZUR3FuNVFaeGwwZlNLakUrcDdQSmU4VGo3bTBGSEZMc2hYeWllUnl5T2VCWjcxWUlMNG1WbGpOcUJDL0VLdmxIdDNxNGJyZFlORU9jdnUwNld5c3lUbVVFMWpFRGp4dzJERFFoQUlkMlQvOHM0Ry9nRjF5TitGU240VWFmT3JKa1NJbm1NVExjTUF3QTVWWVE0WlNrM2VPN25jWDNVK050WU1uWUtFamhMaUl0WlVPY0RaSEoydkgydFE4TURJRVhMVzU0UnFCMUVlWnJGYUIxMU5ndUFTTTNsRFB0bGZOYXVIMjZUd3c4Q2pFMnlTUU9nUzZMU0Uram9Ub0hsUHpBM0RwZkFFRHAySVRwSllPV3dBQUFBUmpTVU5RREEwQUFXNEQ0KzhBQUFDb1pWaEpaazFOQUNvQUFBQUlBQVVCRWdBREFBQUFBUUFCQUFBQkdnQUZBQUFBQVFBQUFFb0JHd0FGQUFBQUFRQUFBRklCS0FBREFBQUFBUUFDQUFDSGFRQUVBQUFBQVFBQUFGb0FBQUFBQUFBQVNBQUFBQUVBQUFCSUFBQUFBUUFHa0FBQUJ3QUFBQVF3TWpJeGtRRUFCd0FBQUFRQkFnTUFvQUFBQndBQUFBUXdNVEF3b0FJQUJBQUFBQUVBQUFBOG9BTUFCQUFBQUFFQUFBQThwQVlBQXdBQUFBRUFBQUFBQUFBQUFEcmxUb0lBQUFBSmNFaFpjd0FBQ3hNQUFBc1RBUUNhbkJnQUFBUjRhVlJZZEZoTlREcGpiMjB1WVdSdlltVXVlRzF3QUFBQUFBQThlRHA0YlhCdFpYUmhJSGh0Ykc1ek9uZzlJbUZrYjJKbE9tNXpPbTFsZEdFdklpQjRPbmh0Y0hSclBTSllUVkFnUTI5eVpTQTJMakF1TUNJK0NpQWdJRHh5WkdZNlVrUkdJSGh0Ykc1ek9uSmtaajBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TVRrNU9TOHdNaTh5TWkxeVpHWXRjM2x1ZEdGNExXNXpJeUkrQ2lBZ0lDQWdJRHh5WkdZNlJHVnpZM0pwY0hScGIyNGdjbVJtT21GaWIzVjBQU0lpQ2lBZ0lDQWdJQ0FnSUNBZ0lIaHRiRzV6T25ScFptWTlJbWgwZEhBNkx5OXVjeTVoWkc5aVpTNWpiMjB2ZEdsbVppOHhMakF2SWdvZ0lDQWdJQ0FnSUNBZ0lDQjRiV3h1Y3pwbGVHbG1QU0pvZEhSd09pOHZibk11WVdSdlltVXVZMjl0TDJWNGFXWXZNUzR3THlJK0NpQWdJQ0FnSUNBZ0lEeDBhV1ptT2xsU1pYTnZiSFYwYVc5dVBqY3lQQzkwYVdabU9sbFNaWE52YkhWMGFXOXVQZ29nSUNBZ0lDQWdJQ0E4ZEdsbVpqcFNaWE52YkhWMGFXOXVWVzVwZEQ0eVBDOTBhV1ptT2xKbGMyOXNkWFJwYjI1VmJtbDBQZ29nSUNBZ0lDQWdJQ0E4ZEdsbVpqcFlVbVZ6YjJ4MWRHbHZiajQzTWp3dmRHbG1aanBZVW1WemIyeDFkR2x2Ymo0S0lDQWdJQ0FnSUNBZ1BIUnBabVk2VDNKcFpXNTBZWFJwYjI0K01Ud3ZkR2xtWmpwUGNtbGxiblJoZEdsdmJqNEtJQ0FnSUNBZ0lDQWdQR1Y0YVdZNlVHbDRaV3hZUkdsdFpXNXphVzl1UGpNMk9Ed3ZaWGhwWmpwUWFYaGxiRmhFYVcxbGJuTnBiMjQrQ2lBZ0lDQWdJQ0FnSUR4bGVHbG1Pa052Ykc5eVUzQmhZMlUrTVR3dlpYaHBaanBEYjJ4dmNsTndZV05sUGdvZ0lDQWdJQ0FnSUNBOFpYaHBaanBUWTJWdVpVTmhjSFIxY21WVWVYQmxQakE4TDJWNGFXWTZVMk5sYm1WRFlYQjBkWEpsVkhsd1pUNEtJQ0FnSUNBZ0lDQWdQR1Y0YVdZNlJYaHBabFpsY25OcGIyNCtNREl5TVR3dlpYaHBaanBGZUdsbVZtVnljMmx2Ymo0S0lDQWdJQ0FnSUNBZ1BHVjRhV1k2UTI5dGNHOXVaVzUwYzBOdmJtWnBaM1Z5WVhScGIyNCtDaUFnSUNBZ0lDQWdJQ0FnSUR4eVpHWTZVMlZ4UGdvZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0E4Y21SbU9teHBQakU4TDNKa1pqcHNhVDRLSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdQSEprWmpwc2FUNHlQQzl5WkdZNmJHaytDaUFnSUNBZ0lDQWdJQ0FnSUNBZ0lEeHlaR1k2YkdrK016d3ZjbVJtT214cFBnb2dJQ0FnSUNBZ0lDQWdJQ0FnSUNBOGNtUm1PbXhwUGpBOEwzSmtaanBzYVQ0S0lDQWdJQ0FnSUNBZ0lDQWdQQzl5WkdZNlUyVnhQZ29nSUNBZ0lDQWdJQ0E4TDJWNGFXWTZRMjl0Y0c5dVpXNTBjME52Ym1acFozVnlZWFJwYjI0K0NpQWdJQ0FnSUNBZ0lEeGxlR2xtT2tac1lYTm9VR2w0Vm1WeWMybHZiajR3TVRBd1BDOWxlR2xtT2tac1lYTm9VR2w0Vm1WeWMybHZiajRLSUNBZ0lDQWdJQ0FnUEdWNGFXWTZVR2w0Wld4WlJHbHRaVzV6YVc5dVBqTTJPRHd2WlhocFpqcFFhWGhsYkZsRWFXMWxibk5wYjI0K0NpQWdJQ0FnSUR3dmNtUm1Pa1JsYzJOeWFYQjBhVzl1UGdvZ0lDQThMM0prWmpwU1JFWStDand2ZURwNGJYQnRaWFJoUGdyMGFLTE1BQUFMOGtsRVFWUm9CZTFaZVhSVnhSbWZ1WGZ1OHBZc2hCaFdXeTJCUWhVa1JJd05FSkVkTklRdGJHRXJJQzVvUmVUVTFrUHJPM3BPanpzdHJTRFVDTFVCSVNHUVFGaUNSUFpOSUVwRVVxSENNU2dRZ1lRWDhyWjdaKzd0TjY5ZVQ2UUplUzhKNEIvdkp1L05mWE8vK1daKzN6THpmZDlGS0hKRkpCQ1JRRVFDRVFsRUpCQ1J3TzJTQUw0WkUyYytsZW44K2tLVkl0dmFHTDhkTmFwbS9Qang3R2JNMHhTZUxRYTRWK2JRUkQrakdZSk5Ic3lvbmhqd2FRNk1EQUNLSzBVaUhIV3F6dlcvSHpWOXgrMEczMnpBNlhNbXhWZlV1bC8wK0gyL01aQVppNG1BTVB3WmhvbE14aEI4SXlJVEpFb0VTU2JlSmZyb3k4ZlhsK3hzaW5aYVlreXpBUGVlTUt4M2xjK1RqV3h5ZDBBSS93WUNmQWhqakVSUjREZkl4QUNaZ3c4S0FFU2lVWCtVYW4reExIL0hYMkJ5b0w2MVY1TUI5NXN5cHRjbDdkcTJBTlh1NEpvVVZSbUpCcnBxQkxRZGdvRU8ycDIyS2t4a0d6UFp2VjZ2YnpBempNNG16Q1lTRVVtS2pHUUR6UzM3Y1B1U1d3c1hkTkNVQ1FlT0h0MzZySDVwTjFMSVBTYTRxY2tNWkpQVW5PaW8ySmNQcjh3L2ZUM1BRWm1aTVJjQ2wyZnBLdjZUSWFBWVpKcElNREdWR1hybVJQN0g3MTVQZnpOL053bHdqL0dEMzZ4bCt2TUdvMkM2SWxJWmVlVkVRY2xMd095R0p2cmd6TEdEcWozdXRaVHBjU1ozQVoweGllR25UMi9aZjh0QWh3MjQ5OWhIZm5IRjd5NDFCRFBHQkUxSnBwQjlldk8reHhvRGEya3RhZHpnZ2RlTVFLNU9hUnozZFVtU21DcEl6M1kxWTkvTnk4dTc2Y2NYN0N6aFhWNVJHNGR0SklidnhvU0lsenZHSnJoQ0JjdG4rblRkUnlWMlF4d3ZHcmhLZ0oyYklVT0VmV0RoSlptMUMyOGxUYU1PQzdEcGNnbWF6ei9FQUovbHZvdDBmZk91VmV1L0NYZnFzb0tkSmEyZHJjYXJrbHd0WTNMRWljblFwdkFKZDE1T0h4YmdqSW9LaDA1WklqOWlSQUxucWtDMk4yVlNQdWJJbXFLU0tFcjZkb3B2TzdRMHY2U3NxWHpDSFVmQ0dWQlJkVVlrTmtrQy9RWjNac1Z1dXh6TytPdHBEK2R0UFZtM2I4YU1HV281cXVsWjY2L3R3WHhhWjFHUm1HeVhUOGthT242b1MrOVBzY3NGQjMzenJyQUF4OGJHb212VjFYQUtnZWZCMmF1WmdiREdON1RVWnhZdlZuYnZMWnE1MzMzMkNTekw5MEt3SWpBSkk0R1lpRklkdWIxK21saGFjcmpYNU9GTGozVkorYkE1d01NeTZmNTM5ZlF5WDZDS1IxQ3lRMFZZSUw5cUNFU28vZjJ6eG5UOGVOL0dnb0NNbHhoRTdLSHJtc0FvUXdLUDFPRG8wZ01hQXJVU1V5Rjl2S0tSMDczOHdBZDlKMDl1RlNyLzYrbkU2enR1OUh2WHJsMnNYYzh1cVVnU2U3Q0FqalMvUDJwSXI5U1ZKMCtldk9INTJ4RFB0RmtUazY3UTJvS0FxZi9hcEJSaGlNS3d6alRSTUkrcWtySmZZT2FYaGsvWHNZZ1RCRW5FVEFlcm9yU0gzKzlPVG4xb1dQNnBZOGYwaG5nMzFCK1doamtUZ1FrRm10Y2ZqSnRGdTVKeUN0ZU1iWWo1amZxVEp6N3l5SVdhNzdacWlIWkRvRTBCd0NvbVhoL25pT21iMVhOQTZvazF4Uk5QNXBXTW0ySnI5MENjNmhoZ2wrUzlJaVFoaUxLcmlpamxKcmR2cjkySWYwUFB3ZzQ4MHRQVDdlVzQ1cEFwQzkwTk1EM0RwNTIzSXltOXZIaHZhVU9UMU8zbnVVVlNWdnFUR3RiZTBobFYrVjRBK1pVSlI5UXJaVG5iWEJDTTFHc3RUN2xjemdOZkhuaFJFcVdpSXptYkQ5VGxHYzU5MklBNTg5NlRIazIvN0hVWDBJQUdhd1YvbHFSekRwdDlWTm5hNGh1Q2RybGNaTU9aVDE3emFvSDVQRXJqaHlJUjhEVzdRWjR0L2JCNFJUZ0xieXB0V0Q1c1RYTCt4S2xUYlR2ZHJWTnNQZ3liQzhhS0dBT1I4WWdPM1grNXUvS0xyeTVZZEhYYmdkT210VDU2OWZRS1N0QnNIbkpqQWRCcXRFSTFwRW1mcmQyK3dhSWROQ2V6ZTRma3JtTEZzZkphcTY4bDJ5WUI1Z3U0ZlBycmZmRjNkYXlreUJnR09aY0FKM09NNzVwblJHejd0cnZkRlJkK0JEcHR4dGpPRnoyVjYzUmtRSlRHZDJBUnlZUWNqb3RwTmZib1B6Y2R0UUNsVEJ2NWNMWHVMNnIxK29aMFRrN2UrczN4azllc1p5M1ZocjFwMVozNHE0OE9MblBJeWx6QndKUjZOV1FTZkNkMmtLSnVJMUovYnRHbFBUNCtyUnI3dHhzMktTWFl4OENVdmZxNjlvSmp4UDZsZVY5YWRQMW1qZWxUdy94Yk5KUEZHN0tRNHBGOGhTbXpKN1d4bnJkVTJ5ekFmQkgvM3JoN3VVQ051V0RhaGd5SnZkUHBYR2tYQTVmNHMvdkdEcGxaZWZYS1pzMmdkNEhsQnhOL1ZTQ3Zwc1VsVGk3T3pxdmlOTllWTGFzblpVRXM1SlVTQVdqQlhaSnJQSmMycEUzTXVOT2lhWW0yU1p0V2ZSTjNIZm5RWTJDbVJ0bjZrbXpZa0lRZVdTTmNYcDl2SWFTUlFYY2xJdkZHT1p6emoyUVhMbThvdTNLdFdLRnVPN2dwMjYxNUoxTS9XQXdRS2tUKzR1NVdiVWNYTFY3NWY0V0YrdGJSV0YrTEFiWW1HcDQxUExwQ3A4dW9qQ2N5blVJM2VMZW1mV3N6eFprbkN2YjhrR3prNXVhSzlWVXdGME9ZK2U2K2pXOVFDVDJEUWR1eVhVV0U0ZklvbldUc3FhZWFZczBiYXR1aWdGUEdQdHI1c3U1ZUNiNmNpc0VzUlZWQ0JPTlBWU1JubGY1cmM3bTFxRjV3ckZGQ2Z4ZGxkenkzZjFuK0Q1dVc5UndzQkNmUHluaGJsOUE4SGxvR2EyWUdMbzkzeG1mc1diYTZXWnB1dGc5Ymkrd3plMXkvR2xVdnhpcEpEVllxSVdmR1huMWJRbFRzaUxwZzc1K1pNYzFEZldzOFdxQnZsZHU5cWUrVTBmZFpQS3lXQngvSHNndm5LenFDeXViL0hFQndxdDFxUlgvaGtQa1RtK1hUWVdVN3NML2llOGNNbUNWS2tqTmVpYzVMYk5lcTl0aVpNekVCTEdaVytXdi95QkNMNFpvVlRCRUpPbHZheFl4ZXNHbEpucGNENFg3ZGErYklsN3dtWFlnZGtpRHhQajhOMUFZQzlWb1pCdzBGaCtlVHpoNUJ1cXJNQ3lZU0F1dDI4VXJOSXVDVjJWQkVaZ210b2JiZXllb2o3ajhuUGY3U1ZjMmxZVG9YRXdDRjhCVlRZejVLbVZOUVNTeXZSUEkvVVJDb2d1US9IRisxNVMxclVWT25UblY4anF2ZTBRbWFUaUZKNExReUZnNjFkOFpQTFY2Uzg1LzY1clA2ZUpVbDVkdmo3L2lJOFlUdThTR21VV1pEMHNObGE0cjNXalRodENHYnRNOGo5R2VpOFNRUytRc1VreWNQclJsQkhiRXN4dklLSk45UkNSSXVPckE4cFd6MTFqY3RzS2xUUnlkODRqMmY1OUcxNmR3ZlJVbEVOaUlWSmlEYm80MkI1VUI0N3R1NVE4Y1g0T3craGNCNjVDaTdpTzN5OUhCQTFxVU5HZkNoVllYNXJVUjdQOEhMMW1LTmZvZXhZRWdFTmlVaTZpSVd2eEw5eGwrakJMVlA2YXF0YTYwSkJzeVowS2xXWWx0d2xEdzg2SXJjcjJ1MUpmMlNoazRvK1dEREZZdXVzWGFWNjI4MVNHYzVDRXBMWE9DUUtxYk5jYzJ4TnphdXZ1Y2grM0J3NjhncDVGbktnWUd6UjdieFVmSXpVU1Z4WUdFWDdvbUxPZnYrNisvL0tBeE1talQ4b2ZQdTZ2ZXduU1FHVFZpUmZFUXpYdjRzWit0cmx2YnJXMUJEZlRIUlVYdXZVcjhKR1JxbUdIVTQ1ZmEyQjlvYnVrTjl2RUlHWEhkd3lYc2JLK0UzL3dTdnc5Wk5uVmJBNGlCWVdpTHlhUWdTZUVRa29lYU82TGpjcG9EbGJFMUZ2U0JBL1lNR3FHcFNSblRrVStwTUYvSnR5Q1lkTXNmdkNWOFlOYzBWbzZpTFpJY0N5YjNBNjg5dEt2M3Vvb0Z6SjNRSmx4ZW5Gd0phUEZSWkZOZ1hFV1BnRzB6Z1VVM1kxMDBEektPb0l5czNMZ0MvWGtRa09JVEFKeUN6NnZadFZWWGhBeE5HaEEyNnh1dE5BcUNZdjNaVmJNcDNOdExxWXRob1ljQk5BOHdYQStackhPeXdia0VVVVJkQlNvQjBYNEJydXF0WFJZVjl3OUMwYStkT0l0cmtMS0tDdFVCcUNadGw2WTdseTkwL09jQkIwQzVzSEZpYXQwRFI4U0lCa241ZWw4SU91YXRIOXhmMm5UWTZKRTF2Vy8zT2t6bzJIdVN4dVE3MU5CelFWemNGTEI5elV6VnNMWXByK2xoaTBZSllXOVFpQ2JURU5BMXEya2JYS3ROYmVQL0U0VWtXWFgxdDhveU15VzYvNTFVS1k0THZzekErbUJCbGJLeVBOcFMra0NPdFVKZzFSbU5DaHBTMlovMGIxUUhQYzhHa2dOZWZEVlJsYzloZXY4TVdtNXNhMytrYzFMMG9mT1RpYzUvZm8wdm00d0dEelFiZkZRV0k3aUNLcTQwV2xXRjcvNTY3djdHNUducCtTd0h6UlpndVUwZzVOK1pOeUhtZk0wMGorSTZLMk9DRTBXaU5vZWxud1VldlFIMDZnZXEwQzFZa0dkN2E4VGljMTVDb1U1QWVPL1NQZ3BVTmdRbWwvNVlENW92aW9KUEtoeit2MjhTRlVBQ001dVZlSHA3eUM2SW9lT05nSWtZaEt2dSsrbUg2OVcvc2dqd1A2bC81UWFKbWZOMFd3Tlo2MDU3TzZ1Nmwzbmsrbno4RDlOaGFoQklSUDc0TW5tQkF2QzdKOGtXQ1NLN0N6TGNQWksvLzJoclhuUGEyQXJZVzNuLzJtSTVlZy9XR0FuZG5NT2tFL3pWUEpTSGtSUHUyOGFVYi8vemVEeEdkUlI5cEl4S0lTQ0FpZ1lnRUloS0lTQ0FpZ1lnRWZvb1MrQzhIUFJNbWlJTzdQUUFBQUFCSlJVNUVya0pnZ2c9PSIgeD0iNDciIHk9IjU1IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiLz48dGV4dCB4PSI3NiIgeT0iNzEiIGZvbnQtZmFtaWx5PSItYXBwbGUtc3lzdGVtLHN5c3RlbS11aSxSb2JvdG8sc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjYwMCIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utb3BhY2l0eT0iLjQ1IiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgcGFpbnQtb3JkZXI9InN0cm9rZSI+U3Rld2FyZE1EPC90ZXh0PjwvZz48L3N2Zz4=";
  var CSS =
    "html." + ON + " [" + ATTR + '="s"]{position:relative}' +
    "html." + ON + " [" + ATTR + ']::after{content:"";position:absolute;inset:0;pointer-events:none;' +
    "background:url(" + TILE + ") 0 0/220px 132px repeat;opacity:.3;border-radius:inherit}";

  var DEBOUNCE_MS = 80, TOAST_GAP_MS = 4000;
  var plugin = null, platform = "", timer = 0, visible = false, secureSent = null, lastToast = 0, lastLang = "en";

  function findPlugin() {
    var C = W.Capacitor;
    try {
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      if (C.isPluginAvailable && !C.isPluginAvailable("CaptureGuard")) return null;
      return (C.Plugins && C.Plugins.CaptureGuard) || null;
    } catch (e) { return null; }
  }

  function isReal(img) {
    var s = img.getAttribute("src") || "";
    return REAL.test(s) || REAL.test(img.currentSrc || "");
  }
  function onScreen(img) {
    var r = img.getBoundingClientRect();
    var vw = W.innerWidth || D.documentElement.clientWidth, vh = W.innerHeight || D.documentElement.clientHeight;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  }
  function mark(img) {
    var p = img.parentElement;
    if (!p || p.hasAttribute(ATTR)) return;
    var pos = "";
    try { pos = W.getComputedStyle(p).position; } catch (e) {}
    p.setAttribute(ATTR, !pos || pos === "static" ? "s" : "p");
  }

  // One pass: mark containers, work out whether a real image is on screen, drive FLAG_SECURE.
  function scan() {
    timer = 0;
    var imgs = D.getElementsByTagName("img"), any = false, lang = "en";
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!isReal(img)) continue;
      mark(img);
      if (!any && onScreen(img)) {
        any = true;
        var l = img.closest && img.closest("[lang]");
        lang = l && /^hi/i.test(l.getAttribute("lang")) ? "hi" : "en";
      }
    }
    visible = any;
    lastLang = lang;
    if (platform === "android" && secureSent !== any) {
      secureSent = any;
      try { plugin.setSecure({ secure: any }); } catch (e) {}
    }
    return any;
  }
  function schedule() { if (!timer) timer = setTimeout(scan, DEBOUNCE_MS); }

  function setCaptured(on) { D.documentElement.classList.toggle(ON, !!on); }

  function onScreenshot() {
    scan();
    // Any screenshot in the app: the language follows the visible image's lesson, else the page.
    var lang = visible ? lastLang : (/^hi/i.test((D.documentElement.getAttribute && D.documentElement.getAttribute("lang")) || "") ? "hi" : "en");
    var now = Date.now();
    if (now - lastToast < TOAST_GAP_MS) return;
    lastToast = now;
    var t = W.toast || W.SMD_toast;
    if (typeof t === "function") t(MSG[lang] || MSG.en);
  }

  function start() {
    plugin = findPlugin();
    if (!plugin) return false;
    try { platform = W.Capacitor.getPlatform(); } catch (e) { platform = ""; }
    var st = D.createElement("style");
    st.id = "smdCaptureGuardCss";
    st.textContent = CSS;
    (D.head || D.documentElement).appendChild(st);

    try { plugin.addListener("captureChange", function (e) { setCaptured(e && e.captured); schedule(); }); } catch (e) {}
    try { plugin.addListener("screenshot", onScreenshot); } catch (e) {}
    try {
      var p = plugin.getState();
      if (p && p.then) p.then(function (s) { setCaptured(s && s.captured); }, function () {});
    } catch (e) {}

    if (W.MutationObserver) {
      new W.MutationObserver(schedule).observe(D.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["src", "class", "style", "hidden"]
      });
    }
    W.addEventListener("scroll", schedule, { capture: true, passive: true });
    W.addEventListener("resize", schedule);
    W.addEventListener("load", schedule, true); // img load events, captured at window
    D.addEventListener("visibilitychange", schedule);
    scan();
    return true;
  }

  W.SMD_CaptureGuard = {
    start: start, scan: scan, onScreenshot: onScreenshot, setCaptured: setCaptured,
    state: function () { return { active: !!plugin, platform: platform, visible: visible, secure: secureSent, lang: lastLang }; },
    MSG: MSG
  };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start);
  else start();
})();
