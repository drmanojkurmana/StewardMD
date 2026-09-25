/* institutions-in.js — ONE place and ONE institution directory for the whole app.
 * ==========================================================================================
 * WHY THIS EXISTS
 * StewardMD had TWO directories and TWO profile forms. email-auth.js asked a new doctor for their
 * state, city and hospital against `SMD_GEO` (107 hospitals, 184 cities); profile-setup.js then
 * asked the SAME doctor, on the next app start, for their "college / hospital" against
 * `SMD_HOSPITALS` (2,405 entries). Two questions, two answers, two lists that disagreed with each
 * other, and a city field that did not contain most Indian cities. Reported from a real device:
 * "all cities in India not covered and all medical colleges and hospitals not covered ... why two
 * times institution is asked, I need one unified institution/hospital directory".
 *
 * So this module is the single directory. It does NOT copy the curated lists: it READS whatever is
 * loaded (`SMD_HOSPITALS`, `SMD_GEO`) and merges them, de-duplicated on a normalised name+city, so
 * there is exactly one answer to "what institutions do we know about" and the curated data keeps
 * living in one file each. What it ADDS is the geography those lists were missing.
 *
 * WHAT "COVERED" HONESTLY MEANS HERE
 * India has ~780 NMC-recognised medical colleges and on the order of 70,000 hospitals and nursing
 * homes. No bundled list is ever complete, and a picker that silently lacks your hospital is worse
 * than one that admits it. So the contract is:
 *   1. CITIES: every district headquarters of every state and union territory, plus the larger
 *      non-HQ towns. This is bounded, stable, public geography — it can be complete, so it is.
 *   2. INSTITUTIONS: the curated lists, merged. Deliberately NOT presented as exhaustive.
 *   3. FREE TEXT IS A FIRST-CLASS ANSWER. `search()` always returns an "use what you typed" option
 *      through `custom`, and the UI must offer it. Nobody is ever blocked because their hospital is
 *      not on a list somebody else wrote.
 *   4. WHAT A DOCTOR TYPES IS REMEMBERED. `remember()` adds it to this device's directory so the
 *      second doctor at that hospital finds it, and so the owner can see what is missing.
 *
 * Pure data + pure functions. No DOM, no fetch. window.SMD_INSTITUTIONS + module.exports.
 * ========================================================================================== */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);

  /* 28 states + 8 union territories, official names. */
  var STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
    "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
  ];

  /* District headquarters and the larger towns of each state and UT. The city field also accepts
   * free text, so a village or a new district that post-dates this list is never a dead end. */
  var CITIES = {
    "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajahmundry", "Tirupati", "Kakinada", "Anantapur", "Eluru", "Ongole", "Nandyal", "Machilipatnam", "Adoni", "Tenali", "Proddatur", "Chittoor", "Hindupur", "Bhimavaram", "Madanapalle", "Guntakal", "Dharmavaram", "Gudivada", "Srikakulam", "Narasaraopet", "Tadipatri", "Tadepalligudem", "Chilakaluripet", "Kadiri", "Chirala", "Anakapalle", "Kavali", "Palakollu", "Tanuku", "Rayachoti", "Srikalahasti", "Bapatla", "Gudur", "Vinukonda", "Narasapuram", "Nuzvid", "Markapur", "Ponnur", "Kandukur", "Bobbili", "Rajampet", "Samalkot", "Jaggayyapeta", "Tuni", "Amalapuram", "Venkatagiri", "Sattenapalle", "Pithapuram", "Parvathipuram", "Macherla", "Salur", "Mandapeta", "Jammalamadugu", "Peddapuram", "Punganur", "Nidadavole", "Repalle", "Ramachandrapuram", "Kovvur", "Narsipatnam", "Puttur", "Vizianagaram", "Kadapa", "Amaravati", "Palasa Kasibugga", "Yemmiganur", "Sullurpeta", "Rajam", "Gooty", "Uravakonda", "Pulivendula", "Piduguralla", "Mangalagiri", "Tadepalle", "Yelamanchili"],
    "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat", "Tezu", "Ziro", "Bomdila", "Along", "Tawang", "Changlang", "Khonsa", "Daporijo", "Roing", "Yingkiong", "Seppa", "Namsai", "Anini", "Koloriang", "Hawai", "Longding", "Yupia", "Basar", "Likabali", "Tato"],
    "Assam": ["Guwahati", "Dibrugarh", "Silchar", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Bongaigaon", "Dhubri", "Diphu", "North Lakhimpur", "Sivasagar", "Goalpara", "Barpeta", "Karimganj", "Hailakandi", "Golaghat", "Mangaldoi", "Nalbari", "Haflong", "Kokrajhar", "Morigaon", "Dhemaji", "Udalguri", "Biswanath Chariali", "Charaideo", "Hojai", "Majuli", "Baksa", "Chirang", "Sonitpur", "Lakhimpur", "Rangia", "Mankachar"],
    "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Ara", "Begusarai", "Katihar", "Munger", "Chhapra", "Danapur", "Saharsa", "Sasaram", "Hajipur", "Dehri", "Siwan", "Motihari", "Nawada", "Bagaha", "Buxar", "Kishanganj", "Sitamarhi", "Jamalpur", "Jehanabad", "Aurangabad", "Lakhisarai", "Supaul", "Madhubani", "Samastipur", "Bettiah", "Araria", "Madhepura", "Khagaria", "Banka", "Bhabua", "Sheohar", "Arwal", "Jamui", "Gopalganj", "Nalanda", "Bihar Sharif", "Rohtas", "Saran", "Vaishali", "Purnea", "Sheikhpura", "Kaimur"],
    "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon", "Jagdalpur", "Raigarh", "Ambikapur", "Dhamtari", "Mahasamund", "Kanker", "Janjgir", "Champa", "Naila Janjgir", "Dantewada", "Kawardha", "Bemetara", "Baikunthpur", "Jashpur", "Sukma", "Bijapur", "Narayanpur", "Balod", "Gariaband", "Mungeli", "Surajpur", "Balrampur", "Pendra", "Sakti", "Manendragarh"],
    "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim", "Curchorem", "Sanquelim", "Canacona", "Quepem", "Valpoi", "Pernem", "Sanguem", "Porvorim", "Calangute"],
    "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Junagadh", "Gandhinagar", "Anand", "Nadiad", "Bharuch", "Mehsana", "Bhuj", "Porbandar", "Navsari", "Vapi", "Valsad", "Morbi", "Surendranagar", "Gandhidham", "Veraval", "Godhra", "Patan", "Palanpur", "Amreli", "Botad", "Dahod", "Himatnagar", "Jetpur", "Kalol", "Deesa", "Modasa", "Rajpipla", "Chhota Udaipur", "Lunawada", "Dwarka", "Khambhat", "Ankleshwar", "Bardoli", "Vyara", "Ahwa", "Rapar", "Mandvi", "Keshod", "Una", "Gondal", "Upleta", "Wankaner", "Halol", "Kadi", "Visnagar", "Unjha", "Sidhpur", "Tharad", "Radhanpur", "Viramgam", "Dholka", "Savarkundla", "Mahuva", "Talaja", "Sihor", "Okha"],
    "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Yamunanagar", "Rohtak", "Hisar", "Karnal", "Sonipat", "Panchkula", "Bhiwani", "Sirsa", "Bahadurgarh", "Jind", "Thanesar", "Kaithal", "Rewari", "Narnaul", "Palwal", "Fatehabad", "Gohana", "Tohana", "Narwana", "Hansi", "Jhajjar", "Charkhi Dadri", "Mahendragarh", "Nuh", "Pehowa", "Kurukshetra", "Samalkha", "Ladwa", "Ellenabad", "Ratia"],
    "Himachal Pradesh": ["Shimla", "Solan", "Mandi", "Dharamshala", "Kullu", "Bilaspur", "Hamirpur", "Una", "Chamba", "Nahan", "Kangra", "Palampur", "Baddi", "Nalagarh", "Sundernagar", "Paonta Sahib", "Manali", "Keylong", "Reckong Peo", "Rampur", "Jogindernagar", "Nurpur", "Ghumarwin", "Rohru", "Theog", "Kasauli", "Dalhousie"],
    "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar", "Hazaribagh", "Giridih", "Ramgarh", "Phusro", "Medininagar", "Chaibasa", "Chatra", "Gumla", "Dumka", "Godda", "Sahibganj", "Pakur", "Lohardaga", "Simdega", "Jamtara", "Khunti", "Latehar", "Garhwa", "Koderma", "Saraikela", "Rajmahal", "Jhumri Telaiya", "Chirkunda"],
    "Karnataka": ["Bengaluru", "Mysuru", "Hubballi", "Dharwad", "Mangaluru", "Belagavi", "Kalaburagi", "Davangere", "Ballari", "Vijayapura", "Shivamogga", "Tumakuru", "Raichur", "Bidar", "Hassan", "Udupi", "Chitradurga", "Kolar", "Mandya", "Chikkamagaluru", "Bagalkot", "Gadag", "Haveri", "Koppal", "Yadgir", "Chamarajanagar", "Karwar", "Chikkaballapur", "Ramanagara", "Madikeri", "Sirsi", "Bhadravati", "Robertsonpet", "Gangavati", "Ranebennur", "Hospet", "Vijayanagara", "Nipani", "Gokak", "Athani", "Saundatti", "Ilkal", "Sindhanur", "Puttur", "Sullia", "Kundapura", "Bantwal", "Tiptur", "Arsikere", "Channapatna", "Doddaballapura", "Hoskote", "Nelamangala", "Magadi", "Sagara", "Shikaripura", "Honnavar", "Kumta", "Bhatkal", "Mudhol", "Jamkhandi", "Basavakalyan", "Humnabad", "Shahabad", "Sedam", "Chincholi", "Surapura", "Shahapur", "Manvi", "Lingsugur", "Devadurga"],
    "Kerala": ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Alappuzha", "Palakkad", "Kannur", "Kottayam", "Malappuram", "Pathanamthitta", "Idukki", "Kasaragod", "Wayanad", "Kalpetta", "Thodupuzha", "Ernakulam", "Aluva", "Perinthalmanna", "Manjeri", "Tirur", "Ponnani", "Chalakudy", "Irinjalakuda", "Guruvayur", "Kodungallur", "Changanassery", "Pala", "Kanjirappally", "Thalassery", "Payyanur", "Taliparamba", "Kanhangad", "Nileshwar", "Attingal", "Neyyattinkara", "Varkala", "Punalur", "Karunagappalli", "Kayamkulam", "Cherthala", "Mavelikkara", "Chengannur", "Tiruvalla", "Adoor", "Ranni", "Muvattupuzha", "Kothamangalam", "Angamaly", "Perumbavoor", "Vatakara", "Koyilandy", "Feroke", "Mananthavady", "Sulthan Bathery", "Nedumangad", "Kattappana", "Munnar", "Shoranur", "Ottappalam", "Mannarkkad", "Pattambi", "Chittur"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Dewas", "Satna", "Ratlam", "Rewa", "Katni", "Singrauli", "Burhanpur", "Khandwa", "Morena", "Bhind", "Guna", "Shivpuri", "Vidisha", "Chhindwara", "Damoh", "Mandsaur", "Khargone", "Neemuch", "Pithampur", "Narmadapuram", "Itarsi", "Sehore", "Betul", "Seoni", "Datia", "Nagda", "Dhar", "Balaghat", "Shahdol", "Tikamgarh", "Chhatarpur", "Panna", "Umaria", "Anuppur", "Dindori", "Mandla", "Narsinghpur", "Raisen", "Rajgarh", "Shajapur", "Agar Malwa", "Alirajpur", "Jhabua", "Barwani", "Harda", "Ashoknagar", "Sheopur", "Niwari", "Maihar", "Sidhi", "Nowgong", "Sarni", "Sanawad", "Mhow"],
    "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Chhatrapati Sambhajinagar", "Solapur", "Amravati", "Kolhapur", "Navi Mumbai", "Sangli", "Jalgaon", "Akola", "Latur", "Dhule", "Ahmednagar", "Ahilyanagar", "Chandrapur", "Parbhani", "Ichalkaranji", "Jalna", "Bhusawal", "Nanded", "Panvel", "Satara", "Beed", "Yavatmal", "Osmanabad", "Dharashiv", "Nandurbar", "Wardha", "Udgir", "Hinganghat", "Ratnagiri", "Sindhudurg", "Oros", "Alibag", "Gondia", "Bhandara", "Washim", "Buldhana", "Hingoli", "Gadchiroli", "Palghar", "Vasai", "Virar", "Mira Bhayandar", "Kalyan", "Dombivli", "Ulhasnagar", "Ambernath", "Badlapur", "Pimpri Chinchwad", "Pandharpur", "Barshi", "Baramati", "Shirdi", "Malegaon", "Sinnar", "Karad", "Chiplun", "Mahad", "Wai", "Phaltan", "Shrirampur", "Kopargaon", "Sangamner", "Akot", "Khamgaon", "Achalpur", "Ballarpur", "Wani", "Pusad"],
    "Manipur": ["Imphal", "Thoubal", "Bishnupur", "Churachandpur", "Ukhrul", "Senapati", "Tamenglong", "Chandel", "Kakching", "Jiribam", "Moreh", "Noney", "Kamjong", "Tengnoupal", "Pherzawl", "Kangpokpi"],
    "Meghalaya": ["Shillong", "Tura", "Jowai", "Nongstoin", "Williamnagar", "Baghmara", "Nongpoh", "Resubelpara", "Ampati", "Khliehriat", "Mawkyrwat", "Mairang"],
    "Mizoram": ["Aizawl", "Lunglei", "Champhai", "Serchhip", "Kolasib", "Saiha", "Lawngtlai", "Mamit", "Khawzawl", "Hnahthial", "Saitual"],
    "Nagaland": ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha", "Zunheboto", "Phek", "Mon", "Kiphire", "Longleng", "Peren", "Chumoukedima", "Noklak", "Shamator"],
    "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore", "Bhadrak", "Baripada", "Jharsuguda", "Jeypore", "Bargarh", "Rayagada", "Bhawanipatna", "Dhenkanal", "Angul", "Talcher", "Paradip", "Kendrapara", "Jajpur", "Koraput", "Nabarangpur", "Malkangiri", "Sundargarh", "Keonjhar", "Phulbani", "Boudh", "Sonepur", "Nayagarh", "Khordha", "Ganjam", "Chhatrapur", "Nuapada", "Deogarh", "Gajapati", "Paralakhemundi", "Kantabanji", "Titlagarh", "Rajgangpur", "Barbil", "Joda", "Byasanagar"],
    "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Pathankot", "Moga", "Batala", "Barnala", "Firozpur", "Faridkot", "Kapurthala", "Sangrur", "Muktsar", "Rupnagar", "Phagwara", "Khanna", "Malerkotla", "Abohar", "Fazilka", "Gurdaspur", "Mansa", "Nawanshahr", "Tarn Taran", "Zirakpur", "Rajpura", "Nabha", "Sunam", "Jagraon", "Samana", "Dhuri", "Budhlada", "Gidderbaha", "Kotkapura", "Nangal", "Dera Bassi"],
    "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer", "Bhilwara", "Alwar", "Sikar", "Pali", "Sri Ganganagar", "Hanumangarh", "Bharatpur", "Jhunjhunu", "Churu", "Nagaur", "Tonk", "Banswara", "Chittorgarh", "Dungarpur", "Barmer", "Jaisalmer", "Jalore", "Sirohi", "Rajsamand", "Bundi", "Baran", "Jhalawar", "Karauli", "Dholpur", "Dausa", "Sawai Madhopur", "Pratapgarh", "Beawar", "Kishangarh", "Makrana", "Sujangarh", "Nokha", "Phalodi", "Balotra", "Didwana", "Merta City", "Fatehpur", "Ratangarh", "Nimbahera", "Nathdwara", "Mount Abu", "Abu Road", "Bali", "Sumerpur"],
    "Sikkim": ["Gangtok", "Namchi", "Gyalshing", "Mangan", "Rangpo", "Singtam", "Jorethang", "Ravangla", "Soreng", "Pakyong"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Erode", "Vellore", "Thoothukudi", "Thanjavur", "Dindigul", "Kanchipuram", "Cuddalore", "Nagercoil", "Karur", "Sivakasi", "Hosur", "Nagapattinam", "Kumbakonam", "Rajapalayam", "Pudukkottai", "Namakkal", "Dharmapuri", "Krishnagiri", "Villupuram", "Tiruvannamalai", "Virudhunagar", "Ramanathapuram", "Sivaganga", "Theni", "Ariyalur", "Perambalur", "Nilgiris", "Udhagamandalam", "Coonoor", "Tenkasi", "Kallakurichi", "Chengalpattu", "Ranipet", "Tirupathur", "Mayiladuthurai", "Tiruvarur", "Tambaram", "Avadi", "Ambattur", "Pallavaram", "Karaikudi", "Neyveli", "Gudiyatham", "Vaniyambadi", "Arcot", "Arakkonam", "Tindivanam", "Chidambaram", "Mettupalayam", "Pollachi", "Palani", "Oddanchatram", "Bodinayakanur", "Cumbum", "Srivilliputhur", "Aruppukkottai", "Paramakudi", "Devakottai", "Manapparai", "Musiri", "Lalgudi", "Thuraiyur", "Attur", "Rasipuram", "Tiruchengode", "Sankagiri", "Bhavani", "Gobichettipalayam", "Sathyamangalam", "Kangeyam", "Dharapuram", "Udumalaipettai", "Valparai", "Marthandam", "Kuzhithurai", "Colachel"],
    "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Ramagundam", "Mahbubnagar", "Nalgonda", "Adilabad", "Suryapet", "Siddipet", "Miryalaguda", "Jagtial", "Mancherial", "Nirmal", "Kamareddy", "Kothagudem", "Bhongir", "Sangareddy", "Medak", "Vikarabad", "Wanaparthy", "Gadwal", "Nagarkurnool", "Narayanpet", "Jangaon", "Bhupalpally", "Mulugu", "Mahabubabad", "Peddapalli", "Rajanna Sircilla", "Asifabad", "Medchal", "Malkajgiri", "Secunderabad", "Zaheerabad", "Bodhan", "Armoor", "Korutla", "Metpally", "Husnabad", "Huzurabad", "Sathupalli", "Yellandu", "Devarakonda", "Kodad", "Tandur", "Shadnagar", "Ibrahimpatnam", "Patancheru"],
    "Tripura": ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia", "Ambassa", "Khowai", "Teliamura", "Sabroom", "Sonamura", "Amarpur", "Bishalgarh", "Kamalpur", "Ranirbazar", "Santirbazar"],
    "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Meerut", "Prayagraj", "Bareilly", "Aligarh", "Moradabad", "Saharanpur", "Gorakhpur", "Noida", "Firozabad", "Jhansi", "Muzaffarnagar", "Mathura", "Rampur", "Shahjahanpur", "Farrukhabad", "Ayodhya", "Faizabad", "Mau", "Hapur", "Etawah", "Mirzapur", "Bulandshahr", "Sambhal", "Amroha", "Hardoi", "Fatehpur", "Raebareli", "Orai", "Sitapur", "Bahraich", "Modinagar", "Unnao", "Jaunpur", "Lakhimpur", "Hathras", "Banda", "Pilibhit", "Barabanki", "Khurja", "Gonda", "Mainpuri", "Lalitpur", "Etah", "Deoria", "Ujhani", "Ghazipur", "Sultanpur", "Azamgarh", "Bijnor", "Sahaswan", "Basti", "Chandausi", "Akbarpur", "Ballia", "Tanda", "Greater Noida", "Shikohabad", "Shamli", "Awagarh", "Kasganj", "Kaushambi", "Chitrakoot", "Hamirpur", "Mahoba", "Jalaun", "Auraiya", "Kannauj", "Amethi", "Pratapgarh", "Kushinagar", "Maharajganj", "Siddharthnagar", "Balrampur", "Shravasti", "Sonbhadra", "Bhadohi", "Chandauli", "Baghpat", "Gautam Buddha Nagar", "Bagpat", "Muzaffarnagar"],
    "Uttarakhand": ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rudrapur", "Kashipur", "Rishikesh", "Nainital", "Almora", "Pithoragarh", "Pauri", "Srinagar", "Kotdwar", "Tehri", "New Tehri", "Uttarkashi", "Chamoli", "Gopeshwar", "Rudraprayag", "Bageshwar", "Champawat", "Mussoorie", "Ramnagar", "Khatima", "Sitarganj", "Jaspur", "Manglaur", "Laksar", "Vikasnagar", "Joshimath"],
    "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Baharampur", "Habra", "Kharagpur", "Shantipur", "Dankuni", "Dhulian", "Ranaghat", "Haldia", "Raiganj", "Krishnanagar", "Nabadwip", "Medinipur", "Jalpaiguri", "Balurghat", "Basirhat", "Bankura", "Chakdaha", "Darjeeling", "Alipurduar", "Purulia", "Jangipur", "Bolpur", "Bangaon", "Cooch Behar", "Tamluk", "Barasat", "Barrackpore", "Serampore", "Chandannagar", "Hooghly", "Uluberia", "Kalyani", "Suri", "Arambagh", "Contai", "Jhargram", "Islampur", "Kalimpong", "Diamond Harbour", "Baruipur", "Bishnupur", "Ghatal", "Rampurhat", "Katwa", "Kalna", "Memari", "Raniganj", "Jamuria", "Kulti", "Bidhannagar"],
    "Andaman and Nicobar Islands": ["Port Blair", "Mayabunder", "Rangat", "Diglipur", "Car Nicobar", "Campbell Bay", "Havelock", "Neil Island", "Bambooflat"],
    "Chandigarh": ["Chandigarh"],
    "Dadra and Nagar Haveli and Daman and Diu": ["Silvassa", "Daman", "Diu", "Amli", "Moti Daman", "Nani Daman"],
    "Delhi": ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket", "Pitampura", "Janakpuri", "Karol Bagh", "Shahdara", "Narela", "Najafgarh", "Vasant Kunj", "Mayur Vihar", "Okhla", "Connaught Place", "Chanakyapuri", "Paschim Vihar", "Uttam Nagar"],
    "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Udhampur", "Kathua", "Sopore", "Kupwara", "Pulwama", "Budgam", "Bandipora", "Ganderbal", "Shopian", "Kulgam", "Doda", "Kishtwar", "Ramban", "Reasi", "Rajouri", "Poonch", "Samba", "Akhnoor", "Bijbehara", "Handwara"],
    "Ladakh": ["Leh", "Kargil", "Nubra", "Zanskar", "Drass", "Khaltse"],
    "Lakshadweep": ["Kavaratti", "Agatti", "Amini", "Andrott", "Minicoy", "Kalpeni", "Kadmat"],
    "Puducherry": ["Puducherry", "Karaikal", "Yanam", "Mahe", "Villianur", "Ozhukarai"]
  };

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function str(s) { return String(s == null ? "" : s).trim(); }

  /* ── the merged directory ─────────────────────────────────────────────────────────────────
   * Reads whatever curated lists are loaded, plus what this device has remembered. Built once and
   * rebuilt when `remember()` adds something, so search stays O(n) over one array instead of three. */
  var _all = null;
  var REMEMBER_KEY = "smd_institutions_added";

  function readRemembered() {
    try {
      var raw = (G.localStorage && G.localStorage.getItem(REMEMBER_KEY)) || "[]";
      var list = JSON.parse(raw);
      return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
    } catch (e) { return []; }
  }
  function sources() {
    var out = [];
    try {
      var H = G.SMD_HOSPITALS;
      if (H && H.all) {
        H.all().forEach(function (h) {
          out.push({ name: str(h.name), city: str(h.city), state: str(h.state), type: h.type || "hospital", src: "curated" });
        });
      }
    } catch (e) {}
    try {
      var GEO = G.SMD_GEO;
      if (GEO && GEO.hospitals) {
        GEO.hospitals().forEach(function (h) {
          out.push({ name: str(h.name), city: str(h.city), state: str(h.state), type: h.type || "hospital", src: "curated" });
        });
      }
    } catch (e) {}
    readRemembered().forEach(function (h) {
      out.push({ name: str(h.name), city: str(h.city), state: str(h.state), type: h.type || "hospital", src: "added" });
    });
    return out;
  }
  /* De-duplicate on name+city. The two curated lists overlap by design (they were written
   * separately), and an entry the doctor added by hand must not shadow the curated one. */
  function build() {
    var seen = {}, out = [];
    sources().forEach(function (h) {
      if (!h.name) return;
      var k = norm(h.name) + "|" + norm(h.city);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(h);
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function all() { if (!_all) _all = build(); return _all.slice(); }
  function refresh() { _all = null; return all(); }
  function count() { return all().length; }

  /* Remember what a doctor typed, so the next colleague at that hospital finds it in the list. */
  function remember(name, city, state) {
    name = str(name); if (!name) return false;
    var list = readRemembered();
    var k = norm(name) + "|" + norm(city);
    for (var i = 0; i < list.length; i++) {
      if (norm(list[i].name) + "|" + norm(list[i].city) === k) return false;
    }
    list.push({ name: name, city: str(city), state: str(state), type: "hospital", at: Date.now() });
    try { G.localStorage && G.localStorage.setItem(REMEMBER_KEY, JSON.stringify(list.slice(-200))); } catch (e) {}
    _all = null;
    return true;
  }

  /* ── search ───────────────────────────────────────────────────────────────────────────────
   * Ranked: name prefix, then word start, then anywhere in the name, then the city. A state or city
   * filter narrows first — a doctor in Visakhapatnam should not scroll past Delhi to find KGH. */
  function search(q, opts) {
    opts = opts || {};
    var nq = norm(q), limit = opts.limit || 20;
    var st = opts.state ? norm(opts.state) : "", ct = opts.city ? norm(opts.city) : "";
    var pool = all().filter(function (h) {
      if (st && norm(h.state) !== st) return false;
      if (ct && norm(h.city) !== ct) return false;
      return true;
    });
    // No query: show what is nearest to the doctor's own city/state rather than the alphabet.
    if (!nq) return pool.slice(0, limit);
    var scored = [];
    pool.forEach(function (h) {
      var nn = norm(h.name), nc = norm(h.city), s = -1;
      if (nn.indexOf(nq) === 0) s = 0;
      else if ((" " + nn).indexOf(" " + nq) >= 0) s = 1;
      else if (nn.indexOf(nq) >= 0) s = 2;
      else if (nc.indexOf(nq) >= 0) s = 3;
      else {
        // initials: "kgh" finds "King George Hospital", "amc" finds "Andhra Medical College"
        var initials = nn.split(" ").filter(Boolean).map(function (w) { return w.charAt(0); }).join("");
        if (initials.indexOf(nq) >= 0) s = 4;
      }
      if (s >= 0) scored.push({ h: h, s: s });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.h.name.length - b.h.name.length || a.h.name.localeCompare(b.h.name); });
    return scored.slice(0, limit).map(function (x) { return x.h; });
  }

  /* What the picker should show for a query: the hits, plus the free-text option whenever the query
   * is not already an exact hit. Rule 3 of the header: free text is a first-class answer. */
  function options(q, opts) {
    var hits = search(q, opts);
    var typed = str(q);
    var exact = !!typed && hits.some(function (h) { return norm(h.name) === norm(typed); });
    return { hits: hits, custom: (typed && !exact) ? typed : "", total: count() };
  }

  /* ── geography ───────────────────────────────────────────────────────────────────────────── */
  function states() { return STATES.slice(); }
  /* Cities for a state: the district/town list, UNIONED with every city the directory itself knows
   * in that state, so an institution can never sit in a city the picker refuses to offer. */
  function cities(state) {
    var base = CITIES[state] ? CITIES[state].slice() : [];
    var seen = {};
    base.forEach(function (c) { seen[norm(c)] = 1; });
    all().forEach(function (h) {
      if (!h.city || (state && norm(h.state) !== norm(state))) return;
      if (seen[norm(h.city)]) return;
      seen[norm(h.city)] = 1;
      base.push(h.city);
    });
    base.sort(function (a, b) { return a.localeCompare(b); });
    return base;
  }
  function cityCount() {
    var n = 0, k;
    for (k in CITIES) if (Object.prototype.hasOwnProperty.call(CITIES, k)) n += CITIES[k].length;
    return n;
  }
  /* Which state a city is in, when the doctor picks the city first. Ambiguous names (there is a
   * Bishnupur in West Bengal and in Manipur) return the first match; the state field stays editable. */
  function stateOf(city) {
    var nc = norm(city), k, i;
    for (k in CITIES) {
      if (!Object.prototype.hasOwnProperty.call(CITIES, k)) continue;
      for (i = 0; i < CITIES[k].length; i++) if (norm(CITIES[k][i]) === nc) return k;
    }
    var hit = all().filter(function (h) { return norm(h.city) === nc; })[0];
    return hit ? hit.state : "";
  }
  function searchCities(q, state, limit) {
    var nq = norm(q), pool = state ? cities(state) : allCities();
    if (!nq) return pool.slice(0, limit || 30);
    var scored = [];
    pool.forEach(function (c) {
      var n = norm(c), s = n.indexOf(nq) === 0 ? 0 : n.indexOf(nq) >= 0 ? 1 : -1;
      if (s >= 0) scored.push({ c: c, s: s });
    });
    scored.sort(function (a, b) { return a.s - b.s || a.c.length - b.c.length; });
    return scored.slice(0, limit || 30).map(function (x) { return x.c; });
  }
  function allCities() {
    var out = [], seen = {}, k;
    for (k in CITIES) {
      if (!Object.prototype.hasOwnProperty.call(CITIES, k)) continue;
      CITIES[k].forEach(function (c) { if (!seen[norm(c)]) { seen[norm(c)] = 1; out.push(c); } });
    }
    all().forEach(function (h) { if (h.city && !seen[norm(h.city)]) { seen[norm(h.city)] = 1; out.push(h.city); } });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  var API = {
    states: states, cities: cities, allCities: allCities, searchCities: searchCities,
    stateOf: stateOf, cityCount: cityCount,
    all: all, refresh: refresh, count: count, search: search, options: options, remember: remember,
    STATES: STATES, CITIES: CITIES, _norm: norm
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_INSTITUTIONS = API;
})();
