/* StewardMD — India geography + curated hospital directory for the profile step. Additive,
 * self-contained. Exposes window.SMD_GEO. No dependency on app.js.
 *
 * "All hospitals in India" is ~70k+ facilities — impractical to bundle — so this ships a curated
 * list of well-known hospitals (searchable typeahead) with a free-text "add your own" fallback in
 * the profile UI. States + cities are the full standard India list. Purely reference data. */
(function () {
  "use strict";

  // 28 states + 8 union territories (official).
  var STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
    "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
  ];

  // Major cities per state/UT (not exhaustive — the city field also accepts free text).
  var CITIES = {
    "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajahmundry", "Tirupati", "Kakinada", "Anantapur"],
    "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat"],
    "Assam": ["Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Nagaon", "Tinsukia", "Tezpur"],
    "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Begusarai"],
    "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Raigarh"],
    "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa"],
    "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Anand"],
    "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Rohtak", "Hisar", "Karnal", "Sonipat"],
    "Himachal Pradesh": ["Shimla", "Mandi", "Solan", "Dharamshala", "Kullu"],
    "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar", "Hazaribagh"],
    "Karnataka": ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi", "Davanagere", "Kalaburagi", "Manipal", "Udupi", "Shivamogga"],
    "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kottayam", "Kannur", "Alappuzha"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Rewa"],
    "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Thane", "Solapur", "Kolhapur", "Amravati", "Navi Mumbai"],
    "Manipur": ["Imphal", "Thoubal"],
    "Meghalaya": ["Shillong", "Tura"],
    "Mizoram": ["Aizawl", "Lunglei"],
    "Nagaland": ["Kohima", "Dimapur"],
    "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri"],
    "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Pathankot"],
    "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer", "Bhilwara"],
    "Sikkim": ["Gangtok", "Namchi"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Vellore", "Erode", "Thanjavur"],
    "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Secunderabad"],
    "Tripura": ["Agartala", "Udaipur"],
    "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Meerut", "Prayagraj", "Noida", "Bareilly", "Aligarh", "Gorakhpur"],
    "Uttarakhand": ["Dehradun", "Haridwar", "Rishikesh", "Haldwani", "Nainital", "Roorkee"],
    "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Kharagpur", "Darjeeling"],
    "Andaman and Nicobar Islands": ["Port Blair"],
    "Chandigarh": ["Chandigarh"],
    "Dadra and Nagar Haveli and Daman and Diu": ["Silvassa", "Daman", "Diu"],
    "Delhi": ["New Delhi", "Delhi"],
    "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla"],
    "Ladakh": ["Leh", "Kargil"],
    "Lakshadweep": ["Kavaratti"],
    "Puducherry": ["Puducherry", "Karaikal"]
  };

  // Curated well-known hospitals: [name, city, state]. Searchable; free-text covers anything missing.
  var H = [
    // Delhi NCR
    ["All India Institute of Medical Sciences (AIIMS)", "New Delhi", "Delhi"],
    ["Safdarjung Hospital", "New Delhi", "Delhi"],
    ["Ram Manohar Lohia Hospital", "New Delhi", "Delhi"],
    ["Sir Ganga Ram Hospital", "New Delhi", "Delhi"],
    ["Indraprastha Apollo Hospitals", "New Delhi", "Delhi"],
    ["Max Super Speciality Hospital, Saket", "New Delhi", "Delhi"],
    ["Fortis Escorts Heart Institute", "New Delhi", "Delhi"],
    ["BLK-Max Super Speciality Hospital", "New Delhi", "Delhi"],
    ["Medanta - The Medicity", "Gurugram", "Haryana"],
    ["Fortis Memorial Research Institute", "Gurugram", "Haryana"],
    ["Artemis Hospital", "Gurugram", "Haryana"],
    ["Amrita Hospital, Faridabad", "Faridabad", "Haryana"],
    ["Pandit B. D. Sharma PGIMS", "Rohtak", "Haryana"],
    // Chandigarh / Punjab
    ["Postgraduate Institute of Medical Education & Research (PGIMER)", "Chandigarh", "Chandigarh"],
    ["Government Medical College & Hospital (GMCH-32)", "Chandigarh", "Chandigarh"],
    ["Dayanand Medical College & Hospital (DMCH)", "Ludhiana", "Punjab"],
    ["Christian Medical College (CMC) Ludhiana", "Ludhiana", "Punjab"],
    ["Government Medical College, Amritsar", "Amritsar", "Punjab"],
    // Maharashtra
    ["King Edward Memorial (KEM) Hospital", "Mumbai", "Maharashtra"],
    ["Tata Memorial Hospital", "Mumbai", "Maharashtra"],
    ["Seth G.S. Medical College & KEM Hospital", "Mumbai", "Maharashtra"],
    ["Lilavati Hospital & Research Centre", "Mumbai", "Maharashtra"],
    ["Kokilaben Dhirubhai Ambani Hospital", "Mumbai", "Maharashtra"],
    ["Hinduja Hospital", "Mumbai", "Maharashtra"],
    ["Breach Candy Hospital", "Mumbai", "Maharashtra"],
    ["Jaslok Hospital", "Mumbai", "Maharashtra"],
    ["Sir J.J. Hospital", "Mumbai", "Maharashtra"],
    ["Fortis Hospital, Mulund", "Mumbai", "Maharashtra"],
    ["Ruby Hall Clinic", "Pune", "Maharashtra"],
    ["Sassoon General Hospital (B.J. Medical College)", "Pune", "Maharashtra"],
    ["Deenanath Mangeshkar Hospital", "Pune", "Maharashtra"],
    ["Jehangir Hospital", "Pune", "Maharashtra"],
    ["Government Medical College, Nagpur", "Nagpur", "Maharashtra"],
    // Karnataka
    ["Manipal Hospital, Bengaluru", "Bengaluru", "Karnataka"],
    ["Narayana Health / Narayana Institute of Cardiac Sciences", "Bengaluru", "Karnataka"],
    ["Apollo Hospitals, Bannerghatta", "Bengaluru", "Karnataka"],
    ["Fortis Hospital, Bannerghatta Road", "Bengaluru", "Karnataka"],
    ["St. John's Medical College Hospital", "Bengaluru", "Karnataka"],
    ["Victoria Hospital (BMCRI)", "Bengaluru", "Karnataka"],
    ["NIMHANS", "Bengaluru", "Karnataka"],
    ["Kasturba Medical College (KMC) Manipal", "Manipal", "Karnataka"],
    ["Kasturba Medical College, Mangaluru", "Mangaluru", "Karnataka"],
    ["JSS Hospital", "Mysuru", "Karnataka"],
    // Tamil Nadu
    ["Christian Medical College (CMC) Vellore", "Vellore", "Tamil Nadu"],
    ["Apollo Hospitals, Greams Road", "Chennai", "Tamil Nadu"],
    ["Madras Medical College & Rajiv Gandhi Govt. General Hospital", "Chennai", "Tamil Nadu"],
    ["Sri Ramachandra Medical Centre", "Chennai", "Tamil Nadu"],
    ["MIOT International", "Chennai", "Tamil Nadu"],
    ["Fortis Malar Hospital", "Chennai", "Tamil Nadu"],
    ["Stanley Medical College Hospital", "Chennai", "Tamil Nadu"],
    ["PSG Hospitals", "Coimbatore", "Tamil Nadu"],
    ["Kovai Medical Center and Hospital (KMCH)", "Coimbatore", "Tamil Nadu"],
    ["Madurai Medical College & Government Rajaji Hospital", "Madurai", "Tamil Nadu"],
    // Telangana / Andhra Pradesh
    ["Nizam's Institute of Medical Sciences (NIMS)", "Hyderabad", "Telangana"],
    ["Apollo Hospitals, Jubilee Hills", "Hyderabad", "Telangana"],
    ["Yashoda Hospitals", "Hyderabad", "Telangana"],
    ["Care Hospitals", "Hyderabad", "Telangana"],
    ["Osmania General Hospital", "Hyderabad", "Telangana"],
    ["Gandhi Hospital", "Secunderabad", "Telangana"],
    ["Continental Hospitals", "Hyderabad", "Telangana"],
    ["Andhra Medical College / King George Hospital", "Visakhapatnam", "Andhra Pradesh"],
    ["GITAM Institute of Medical Sciences (GIMSR)", "Visakhapatnam", "Andhra Pradesh"],
    ["Sri Venkateswara Institute of Medical Sciences (SVIMS)", "Tirupati", "Andhra Pradesh"],
    // Kerala
    ["Sree Chitra Tirunal Institute (SCTIMST)", "Thiruvananthapuram", "Kerala"],
    ["Government Medical College, Thiruvananthapuram", "Thiruvananthapuram", "Kerala"],
    ["Amrita Institute of Medical Sciences (AIMS)", "Kochi", "Kerala"],
    ["Aster Medcity", "Kochi", "Kerala"],
    ["Rajagiri Hospital", "Kochi", "Kerala"],
    ["Government Medical College, Kozhikode", "Kozhikode", "Kerala"],
    // West Bengal / East
    ["SSKM Hospital (IPGMER)", "Kolkata", "West Bengal"],
    ["Medical College & Hospital, Kolkata", "Kolkata", "West Bengal"],
    ["Apollo Gleneagles Hospitals", "Kolkata", "West Bengal"],
    ["AMRI Hospitals", "Kolkata", "West Bengal"],
    ["Fortis Hospital, Anandapur", "Kolkata", "West Bengal"],
    ["AIIMS Kalyani", "Kalyani", "West Bengal"],
    // Odisha / Jharkhand / Bihar / Assam
    ["AIIMS Bhubaneswar", "Bhubaneswar", "Odisha"],
    ["SCB Medical College & Hospital", "Cuttack", "Odisha"],
    ["Kalinga Institute of Medical Sciences (KIMS)", "Bhubaneswar", "Odisha"],
    ["Rajendra Institute of Medical Sciences (RIMS)", "Ranchi", "Jharkhand"],
    ["Tata Main Hospital", "Jamshedpur", "Jharkhand"],
    ["AIIMS Patna", "Patna", "Bihar"],
    ["Indira Gandhi Institute of Medical Sciences (IGIMS)", "Patna", "Bihar"],
    ["Patna Medical College & Hospital", "Patna", "Bihar"],
    ["Gauhati Medical College & Hospital", "Guwahati", "Assam"],
    ["Assam Medical College", "Dibrugarh", "Assam"],
    // Uttar Pradesh / Uttarakhand
    ["Sanjay Gandhi Postgraduate Institute (SGPGI)", "Lucknow", "Uttar Pradesh"],
    ["King George's Medical University (KGMU)", "Lucknow", "Uttar Pradesh"],
    ["Dr. Ram Manohar Lohia Institute of Medical Sciences", "Lucknow", "Uttar Pradesh"],
    ["Institute of Medical Sciences, BHU", "Varanasi", "Uttar Pradesh"],
    ["Jawaharlal Nehru Medical College, AMU", "Aligarh", "Uttar Pradesh"],
    ["AIIMS Rishikesh", "Rishikesh", "Uttarakhand"],
    ["Himalayan Institute of Medical Sciences", "Dehradun", "Uttarakhand"],
    // Rajasthan / MP / Gujarat / Chhattisgarh
    ["SMS Medical College & Hospital", "Jaipur", "Rajasthan"],
    ["Fortis Escorts Hospital, Jaipur", "Jaipur", "Rajasthan"],
    ["AIIMS Jodhpur", "Jodhpur", "Rajasthan"],
    ["AIIMS Bhopal", "Bhopal", "Madhya Pradesh"],
    ["Gandhi Medical College, Bhopal", "Bhopal", "Madhya Pradesh"],
    ["Mahatma Gandhi Memorial Medical College", "Indore", "Madhya Pradesh"],
    ["Civil Hospital Ahmedabad (B.J. Medical College)", "Ahmedabad", "Gujarat"],
    ["Sterling Hospitals", "Ahmedabad", "Gujarat"],
    ["Zydus Hospitals", "Ahmedabad", "Gujarat"],
    ["Sir Takhtsinhji General Hospital", "Bhavnagar", "Gujarat"],
    ["AIIMS Raipur", "Raipur", "Chhattisgarh"],
    // Others / JIPMER
    ["Jawaharlal Institute of Postgraduate Medical Education & Research (JIPMER)", "Puducherry", "Puducherry"],
    ["Goa Medical College", "Panaji", "Goa"],
    ["Government Medical College, Jammu", "Jammu", "Jammu and Kashmir"],
    ["Sher-i-Kashmir Institute of Medical Sciences (SKIMS)", "Srinagar", "Jammu and Kashmir"]
  ];

  var HOSPITALS = H.map(function (r) { return { name: r[0], city: r[1], state: r[2] }; });

  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  // Typeahead search over the curated list. Optional state filter. Ranked: name-prefix > word-start
  // > substring; then city match. Returns up to `limit` {name,city,state}.
  function searchHospitals(q, opts) {
    opts = opts || {};
    var nq = norm(q); var limit = opts.limit || 8; var stateF = opts.state ? norm(opts.state) : null;
    if (!nq) {
      var base = HOSPITALS.filter(function (h) { return !stateF || norm(h.state) === stateF; });
      return base.slice(0, limit);
    }
    var scored = [];
    for (var i = 0; i < HOSPITALS.length; i++) {
      var h = HOSPITALS[i];
      if (stateF && norm(h.state) !== stateF) continue;
      var nn = norm(h.name), nc = norm(h.city);
      var score = -1;
      if (nn.indexOf(nq) === 0) score = 0;
      else if ((" " + nn).indexOf(" " + nq) >= 0) score = 1;
      else if (nn.indexOf(nq) >= 0) score = 2;
      else if (nc.indexOf(nq) >= 0) score = 3;
      if (score >= 0) scored.push({ h: h, score: score });
    }
    scored.sort(function (a, b) { return a.score - b.score || a.h.name.length - b.h.name.length; });
    return scored.slice(0, limit).map(function (x) { return x.h; });
  }

  function citiesFor(state) { return CITIES[state] ? CITIES[state].slice() : []; }

  try {
    window.SMD_GEO = {
      states: function () { return STATES.slice(); },
      cities: citiesFor,
      hospitals: function () { return HOSPITALS.slice(); },
      searchHospitals: searchHospitals,
      version: 1
    };
  } catch (e) {}
})();
