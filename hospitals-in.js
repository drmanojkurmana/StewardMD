/* ============================================================================
   StewardMD — Indian Hospitals directory (curated)
   Plain ES5, self-contained IIFE. No build step, no imports. Exposes a global
   for the in-app hospital picker.

   Each entry: { name, city, state, type: "medical_college" | "hospital" }
   - "medical_college": teaching hospital attached to a medical college / institute
   - "hospital": government district/general or private/corporate hospital

   This is a curated, human-recognizable list (not an official ranking). Names,
   cities and states are accurate to the best of our knowledge. Deduplicated on
   name+city+state.

   Exposes window.SMD_HOSPITALS = { all, search, byState, states }.
   ========================================================================== */
(function () {
  "use strict";

  var HOSPITALS = [

    /* ==================== DELHI (NCT) ==================== */
    { name: "All India Institute of Medical Sciences (AIIMS), New Delhi", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Maulana Azad Medical College (MAMC)", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Lady Hardinge Medical College", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "University College of Medical Sciences (UCMS)", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Vardhman Mahavir Medical College & Safdarjung Hospital", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Atal Bihari Vajpayee Institute of Medical Sciences & Dr. RML Hospital", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Guru Teg Bahadur Hospital (GTB)", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Lok Nayak Hospital (LNJP)", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "G. B. Pant Institute of Postgraduate Medical Education & Research (GIPMER)", city: "New Delhi", state: "Delhi", type: "medical_college" },
    { name: "Institute of Liver and Biliary Sciences (ILBS)", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Sir Ganga Ram Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Indraprastha Apollo Hospitals", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Max Super Speciality Hospital, Saket", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Fortis Escorts Heart Institute", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "BLK-Max Super Speciality Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Rajiv Gandhi Cancer Institute & Research Centre", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Deen Dayal Upadhyay Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },

    /* ==================== ANDHRA PRADESH ==================== */
    { name: "King George Hospital (KGH)", city: "Visakhapatnam", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Andhra Medical College", city: "Visakhapatnam", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Gayatri Vidya Parishad Institute of Health Care & Medical Technology (GIMSR)", city: "Visakhapatnam", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Apollo Hospitals, Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", type: "hospital" },
    { name: "Care Hospitals, Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", type: "hospital" },
    { name: "Guntur Medical College & Government General Hospital", city: "Guntur", state: "Andhra Pradesh", type: "medical_college" },
    { name: "NRI Medical College & General Hospital", city: "Guntur", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Andhra Hospitals", city: "Vijayawada", state: "Andhra Pradesh", type: "hospital" },
    { name: "Siddhartha Medical College", city: "Vijayawada", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Government General Hospital, Vijayawada", city: "Vijayawada", state: "Andhra Pradesh", type: "hospital" },
    { name: "Sri Venkateswara Institute of Medical Sciences (SVIMS)", city: "Tirupati", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Sri Venkateswara Medical College", city: "Tirupati", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Rangaraya Medical College", city: "Kakinada", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Government General Hospital, Kadapa (Rajiv Gandhi Institute of Medical Sciences)", city: "Kadapa", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Kurnool Medical College & Government General Hospital", city: "Kurnool", state: "Andhra Pradesh", type: "medical_college" },

    /* ==================== ARUNACHAL PRADESH ==================== */
    { name: "Tomo Riba Institute of Health & Medical Sciences (TRIHMS)", city: "Naharlagun", state: "Arunachal Pradesh", type: "medical_college" },
    { name: "Ramakrishna Mission Hospital, Itanagar", city: "Itanagar", state: "Arunachal Pradesh", type: "hospital" },
    { name: "Bakin Pertin General Hospital", city: "Pasighat", state: "Arunachal Pradesh", type: "hospital" },
    { name: "General Hospital, Tezu", city: "Tezu", state: "Arunachal Pradesh", type: "hospital" },
    { name: "District Hospital, Ziro", city: "Ziro", state: "Arunachal Pradesh", type: "hospital" },

    /* ==================== ASSAM ==================== */
    { name: "Gauhati Medical College & Hospital (GMCH)", city: "Guwahati", state: "Assam", type: "medical_college" },
    { name: "Assam Medical College & Hospital", city: "Dibrugarh", state: "Assam", type: "medical_college" },
    { name: "Silchar Medical College & Hospital", city: "Silchar", state: "Assam", type: "medical_college" },
    { name: "Jorhat Medical College & Hospital", city: "Jorhat", state: "Assam", type: "medical_college" },
    { name: "Tezpur Medical College & Hospital", city: "Tezpur", state: "Assam", type: "medical_college" },
    { name: "Fakhruddin Ali Ahmed Medical College", city: "Barpeta", state: "Assam", type: "medical_college" },
    { name: "AIIMS Guwahati", city: "Guwahati", state: "Assam", type: "medical_college" },
    { name: "Gauhati Neurological Research Centre (GNRC) Hospitals", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Nemcare Hospital", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Apollo Hospitals, Guwahati (Apollo Excelcare)", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Down Town Hospital", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Dr. B. Borooah Cancer Institute", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Mahendra Mohan Choudhury Hospital (MMCH)", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "Diphu Medical College & Hospital", city: "Diphu", state: "Assam", type: "medical_college" },

    /* ==================== BIHAR ==================== */
    { name: "AIIMS Patna", city: "Patna", state: "Bihar", type: "medical_college" },
    { name: "Patna Medical College & Hospital (PMCH)", city: "Patna", state: "Bihar", type: "medical_college" },
    { name: "Indira Gandhi Institute of Medical Sciences (IGIMS)", city: "Patna", state: "Bihar", type: "medical_college" },
    { name: "Nalanda Medical College & Hospital (NMCH)", city: "Patna", state: "Bihar", type: "medical_college" },
    { name: "Darbhanga Medical College & Hospital (DMCH)", city: "Darbhanga", state: "Bihar", type: "medical_college" },
    { name: "Sri Krishna Medical College & Hospital (SKMCH)", city: "Muzaffarpur", state: "Bihar", type: "medical_college" },
    { name: "Jawaharlal Nehru Medical College, Bhagalpur", city: "Bhagalpur", state: "Bihar", type: "medical_college" },
    { name: "Anugrah Narayan Magadh Medical College & Hospital", city: "Gaya", state: "Bihar", type: "medical_college" },
    { name: "Government Medical College, Bettiah", city: "Bettiah", state: "Bihar", type: "medical_college" },
    { name: "Vardhman Institute of Medical Sciences", city: "Nalanda (Pawapuri)", state: "Bihar", type: "medical_college" },
    { name: "Paras HMRI Hospital", city: "Patna", state: "Bihar", type: "hospital" },
    { name: "Ruban Memorial Hospital", city: "Patna", state: "Bihar", type: "hospital" },
    { name: "Mahavir Cancer Sansthan", city: "Patna", state: "Bihar", type: "hospital" },
    { name: "Ford Hospital & Research Centre", city: "Patna", state: "Bihar", type: "hospital" },

    /* ==================== CHHATTISGARH ==================== */
    { name: "All India Institute of Medical Sciences (AIIMS), Raipur", city: "Raipur", state: "Chhattisgarh", type: "medical_college" },
    { name: "Pt. Jawahar Lal Nehru Memorial Medical College", city: "Raipur", state: "Chhattisgarh", type: "medical_college" },
    { name: "Dr. Bhimrao Ambedkar Memorial Hospital", city: "Raipur", state: "Chhattisgarh", type: "hospital" },
    { name: "Chhattisgarh Institute of Medical Sciences (CIMS)", city: "Bilaspur", state: "Chhattisgarh", type: "medical_college" },
    { name: "Government Medical College, Rajnandgaon", city: "Rajnandgaon", state: "Chhattisgarh", type: "medical_college" },
    { name: "Late Shri Lakhi Ram Agrawal Memorial Government Medical College", city: "Raigarh", state: "Chhattisgarh", type: "medical_college" },
    { name: "Pt. Deendayal Upadhyay Memorial Medical College", city: "Durg", state: "Chhattisgarh", type: "medical_college" },
    { name: "Ramkrishna Care Hospital", city: "Raipur", state: "Chhattisgarh", type: "hospital" },
    { name: "Narayana Superspeciality Hospital, Raipur", city: "Raipur", state: "Chhattisgarh", type: "hospital" },
    { name: "Balco Medical Centre", city: "Raipur", state: "Chhattisgarh", type: "hospital" },
    { name: "Sri Balaji Institute of Medical Science", city: "Raipur", state: "Chhattisgarh", type: "hospital" },
    { name: "Jawaharlal Nehru Hospital & Research Centre (Bhilai Steel Plant)", city: "Bhilai", state: "Chhattisgarh", type: "hospital" },

    /* ==================== GOA ==================== */
    { name: "Goa Medical College & Hospital (GMC Bambolim)", city: "Bambolim", state: "Goa", type: "medical_college" },
    { name: "Manipal Hospital, Goa", city: "Panaji (Dona Paula)", state: "Goa", type: "hospital" },
    { name: "Healthway Hospitals", city: "Panaji", state: "Goa", type: "hospital" },
    { name: "Victor Hospital", city: "Margao", state: "Goa", type: "hospital" },
    { name: "Apollo Victor Hospital", city: "Margao", state: "Goa", type: "hospital" },
    { name: "Hospicio Hospital", city: "Margao", state: "Goa", type: "hospital" },
    { name: "Vintage Hospital & Medical Research Centre", city: "Panaji", state: "Goa", type: "hospital" },
    { name: "Salgaocar Medical Research Centre (Fomento)", city: "Vasco da Gama", state: "Goa", type: "hospital" },

    /* ==================== GUJARAT ==================== */
    { name: "B. J. Medical College & Civil Hospital, Ahmedabad", city: "Ahmedabad", state: "Gujarat", type: "medical_college" },
    { name: "U. N. Mehta Institute of Cardiology & Research Centre", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Gujarat Cancer & Research Institute (GCRI)", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Institute of Kidney Diseases & Research Centre (IKDRC)", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Sterling Hospitals", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Apollo Hospitals International", city: "Gandhinagar", state: "Gujarat", type: "hospital" },
    { name: "Zydus Hospitals", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "CIMS Hospital", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Government Medical College, Surat & New Civil Hospital", city: "Surat", state: "Gujarat", type: "medical_college" },
    { name: "Medical College Baroda & Sir Sayajirao General Hospital (SSG)", city: "Vadodara", state: "Gujarat", type: "medical_college" },
    { name: "M. P. Shah Government Medical College", city: "Jamnagar", state: "Gujarat", type: "medical_college" },
    { name: "P. D. U. Government Medical College & Civil Hospital", city: "Rajkot", state: "Gujarat", type: "medical_college" },
    { name: "AIIMS Rajkot", city: "Rajkot", state: "Gujarat", type: "medical_college" },
    { name: "Government Medical College, Bhavnagar (Sir T Hospital)", city: "Bhavnagar", state: "Gujarat", type: "medical_college" },
    { name: "Shri M. P. Shah Cancer Hospital", city: "Ahmedabad", state: "Gujarat", type: "hospital" },

    /* ==================== HARYANA ==================== */
    { name: "Pt. B. D. Sharma Postgraduate Institute of Medical Sciences (PGIMS)", city: "Rohtak", state: "Haryana", type: "medical_college" },
    { name: "Kalpana Chawla Government Medical College", city: "Karnal", state: "Haryana", type: "medical_college" },
    { name: "Bhagat Phool Singh Government Medical College for Women", city: "Khanpur Kalan (Sonipat)", state: "Haryana", type: "medical_college" },
    { name: "Medanta - The Medicity", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Fortis Memorial Research Institute (FMRI)", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Artemis Hospital", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Max Super Speciality Hospital, Gurugram", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Paras Hospitals, Gurugram", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Amrita Hospital, Faridabad", city: "Faridabad", state: "Haryana", type: "hospital" },
    { name: "Fortis Escorts Hospital, Faridabad", city: "Faridabad", state: "Haryana", type: "hospital" },
    { name: "Asian Institute of Medical Sciences", city: "Faridabad", state: "Haryana", type: "hospital" },
    { name: "Sarvodaya Hospital & Research Centre", city: "Faridabad", state: "Haryana", type: "hospital" },
    { name: "Maharaja Agrasen Medical College", city: "Agroha (Hisar)", state: "Haryana", type: "medical_college" },
    { name: "Civil Hospital, Panchkula", city: "Panchkula", state: "Haryana", type: "hospital" },

    /* ==================== HIMACHAL PRADESH ==================== */
    { name: "Indira Gandhi Medical College (IGMC)", city: "Shimla", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Dr. Rajendra Prasad Government Medical College", city: "Tanda (Kangra)", state: "Himachal Pradesh", type: "medical_college" },
    { name: "AIIMS Bilaspur", city: "Bilaspur", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Shri Lal Bahadur Shastri Government Medical College", city: "Mandi (Nerchowk)", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Pt. Jawaharlal Nehru Government Medical College", city: "Chamba", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Government Medical College, Hamirpur", city: "Hamirpur", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Maharishi Markandeshwar Medical College & Hospital", city: "Solan (Kumarhatti)", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Fortis Hospital, Kangra", city: "Kangra", state: "Himachal Pradesh", type: "hospital" },
    { name: "Deen Dayal Upadhyay Zonal Hospital", city: "Shimla", state: "Himachal Pradesh", type: "hospital" },

    /* ==================== JHARKHAND ==================== */
    { name: "Rajendra Institute of Medical Sciences (RIMS)", city: "Ranchi", state: "Jharkhand", type: "medical_college" },
    { name: "Mahatma Gandhi Memorial Medical College & Hospital", city: "Jamshedpur", state: "Jharkhand", type: "medical_college" },
    { name: "Patliputra Medical College & Hospital (PMCH Dhanbad)", city: "Dhanbad", state: "Jharkhand", type: "medical_college" },
    { name: "Shaheed Nirmal Mahto Medical College & Hospital", city: "Dhanbad", state: "Jharkhand", type: "medical_college" },
    { name: "Tata Main Hospital", city: "Jamshedpur", state: "Jharkhand", type: "hospital" },
    { name: "Medica Superspecialty Hospital, Ranchi", city: "Ranchi", state: "Jharkhand", type: "hospital" },
    { name: "Health Point Hospital", city: "Ranchi", state: "Jharkhand", type: "hospital" },
    { name: "Central Institute of Psychiatry (CIP)", city: "Ranchi", state: "Jharkhand", type: "hospital" },
    { name: "Meherbai Tata Memorial Hospital", city: "Jamshedpur", state: "Jharkhand", type: "hospital" },
    { name: "Bokaro General Hospital", city: "Bokaro Steel City", state: "Jharkhand", type: "hospital" },
    { name: "Government Medical College, Palamu", city: "Palamu (Medininagar)", state: "Jharkhand", type: "medical_college" },
    { name: "Phulo Jhano Medical College & Hospital", city: "Dumka", state: "Jharkhand", type: "medical_college" },

    /* ==================== KARNATAKA ==================== */
    { name: "Bangalore Medical College & Research Institute (BMCRI / Victoria Hospital)", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "National Institute of Mental Health & Neurosciences (NIMHANS)", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "St. John's Medical College Hospital", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "M. S. Ramaiah Medical College & Hospital", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "Kidwai Memorial Institute of Oncology", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Sri Jayadeva Institute of Cardiovascular Sciences & Research", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Manipal Hospital, Old Airport Road", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Narayana Health City / Narayana Institute of Cardiac Sciences", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Kasturba Medical College (KMC), Manipal", city: "Manipal", state: "Karnataka", type: "medical_college" },
    { name: "Kasturba Medical College (KMC), Mangalore", city: "Mangaluru", state: "Karnataka", type: "medical_college" },
    { name: "Jawaharlal Nehru Medical College (KLE)", city: "Belagavi", state: "Karnataka", type: "medical_college" },
    { name: "J. S. S. Medical College & Hospital", city: "Mysuru", state: "Karnataka", type: "medical_college" },
    { name: "Mysore Medical College & Research Institute", city: "Mysuru", state: "Karnataka", type: "medical_college" },
    { name: "Karnataka Institute of Medical Sciences (KIMS)", city: "Hubballi", state: "Karnataka", type: "medical_college" },
    { name: "Sri Devaraj Urs Medical College", city: "Kolar", state: "Karnataka", type: "medical_college" },

    /* ==================== KERALA ==================== */
    { name: "Government Medical College, Thiruvananthapuram", city: "Thiruvananthapuram", state: "Kerala", type: "medical_college" },
    { name: "Sree Chitra Tirunal Institute for Medical Sciences & Technology (SCTIMST)", city: "Thiruvananthapuram", state: "Kerala", type: "medical_college" },
    { name: "Regional Cancer Centre (RCC)", city: "Thiruvananthapuram", state: "Kerala", type: "hospital" },
    { name: "Government Medical College, Kottayam", city: "Kottayam", state: "Kerala", type: "medical_college" },
    { name: "Government Medical College, Thrissur", city: "Thrissur", state: "Kerala", type: "medical_college" },
    { name: "Government Medical College, Kozhikode", city: "Kozhikode", state: "Kerala", type: "medical_college" },
    { name: "Amrita Institute of Medical Sciences (AIMS)", city: "Kochi", state: "Kerala", type: "medical_college" },
    { name: "Aster Medcity", city: "Kochi", state: "Kerala", type: "hospital" },
    { name: "Lakeshore Hospital (VPS Lakeshore)", city: "Kochi", state: "Kerala", type: "hospital" },
    { name: "Rajagiri Hospital", city: "Kochi (Aluva)", state: "Kerala", type: "hospital" },
    { name: "Jubilee Mission Medical College & Research Institute", city: "Thrissur", state: "Kerala", type: "medical_college" },
    { name: "Malabar Institute of Medical Sciences (Aster MIMS)", city: "Kozhikode", state: "Kerala", type: "hospital" },
    { name: "Believers Church Medical College Hospital", city: "Thiruvalla", state: "Kerala", type: "medical_college" },
    { name: "KIMSHEALTH", city: "Thiruvananthapuram", state: "Kerala", type: "hospital" },
    { name: "Pushpagiri Medical College Hospital", city: "Thiruvalla", state: "Kerala", type: "medical_college" },

    /* ==================== MADHYA PRADESH ==================== */
    { name: "All India Institute of Medical Sciences (AIIMS), Bhopal", city: "Bhopal", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Gandhi Medical College & Hamidia Hospital", city: "Bhopal", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Bhopal Memorial Hospital & Research Centre (BMHRC)", city: "Bhopal", state: "Madhya Pradesh", type: "hospital" },
    { name: "Mahatma Gandhi Memorial Medical College (MGM) & M.Y. Hospital", city: "Indore", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Sri Aurobindo Institute of Medical Sciences (SAIMS)", city: "Indore", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Choithram Hospital & Research Centre", city: "Indore", state: "Madhya Pradesh", type: "hospital" },
    { name: "Bombay Hospital, Indore", city: "Indore", state: "Madhya Pradesh", type: "hospital" },
    { name: "Netaji Subhash Chandra Bose Medical College", city: "Jabalpur", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Gajra Raja Medical College & Jayarogya Hospital", city: "Gwalior", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Shyam Shah Medical College", city: "Rewa", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Government Medical College, Ujjain (R.D. Gardi)", city: "Ujjain", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Bansal Hospital", city: "Bhopal", state: "Madhya Pradesh", type: "hospital" },
    { name: "Chirayu Medical College & Hospital", city: "Bhopal", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Apollo Hospitals, Indore", city: "Indore", state: "Madhya Pradesh", type: "hospital" },

    /* ==================== MAHARASHTRA ==================== */
    { name: "Seth G. S. Medical College & KEM Hospital", city: "Mumbai", state: "Maharashtra", type: "medical_college" },
    { name: "Grant Government Medical College & Sir J. J. Group of Hospitals", city: "Mumbai", state: "Maharashtra", type: "medical_college" },
    { name: "Topiwala National Medical College & B.Y.L. Nair Charitable Hospital", city: "Mumbai", state: "Maharashtra", type: "medical_college" },
    { name: "Lokmanya Tilak Municipal Medical College & Sion Hospital", city: "Mumbai", state: "Maharashtra", type: "medical_college" },
    { name: "Tata Memorial Hospital", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "P. D. Hinduja National Hospital & Medical Research Centre", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Kokilaben Dhirubhai Ambani Hospital", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Lilavati Hospital & Research Centre", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Breach Candy Hospital Trust", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Jaslok Hospital & Research Centre", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Bombay Hospital & Medical Research Centre", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Armed Forces Medical College (AFMC)", city: "Pune", state: "Maharashtra", type: "medical_college" },
    { name: "B. J. Government Medical College & Sassoon General Hospital", city: "Pune", state: "Maharashtra", type: "medical_college" },
    { name: "Ruby Hall Clinic", city: "Pune", state: "Maharashtra", type: "hospital" },
    { name: "Government Medical College & Hospital, Nagpur", city: "Nagpur", state: "Maharashtra", type: "medical_college" },
    { name: "Government Medical College, Aurangabad (Chhatrapati Sambhajinagar)", city: "Chhatrapati Sambhajinagar", state: "Maharashtra", type: "medical_college" },

    /* ==================== MANIPUR ==================== */
    { name: "Regional Institute of Medical Sciences (RIMS)", city: "Imphal", state: "Manipur", type: "medical_college" },
    { name: "Jawaharlal Nehru Institute of Medical Sciences (JNIMS)", city: "Imphal", state: "Manipur", type: "medical_college" },
    { name: "Shija Hospitals & Research Institute", city: "Imphal", state: "Manipur", type: "hospital" },
    { name: "Raj Medicity Hospital", city: "Imphal", state: "Manipur", type: "hospital" },
    { name: "Churachandpur District Hospital", city: "Churachandpur", state: "Manipur", type: "hospital" },

    /* ==================== MEGHALAYA ==================== */
    { name: "North Eastern Indira Gandhi Regional Institute of Health & Medical Sciences (NEIGRIHMS)", city: "Shillong", state: "Meghalaya", type: "medical_college" },
    { name: "Civil Hospital, Shillong", city: "Shillong", state: "Meghalaya", type: "hospital" },
    { name: "Nazareth Hospital", city: "Shillong", state: "Meghalaya", type: "hospital" },
    { name: "Woodland Hospital", city: "Shillong", state: "Meghalaya", type: "hospital" },
    { name: "Ganesh Das Hospital", city: "Shillong", state: "Meghalaya", type: "hospital" },
    { name: "Tura Civil Hospital", city: "Tura", state: "Meghalaya", type: "hospital" },

    /* ==================== MIZORAM ==================== */
    { name: "Zoram Medical College (ZMC)", city: "Falkawn (Aizawl)", state: "Mizoram", type: "medical_college" },
    { name: "Civil Hospital Aizawl", city: "Aizawl", state: "Mizoram", type: "hospital" },
    { name: "Synod Hospital", city: "Aizawl (Durtlang)", state: "Mizoram", type: "hospital" },
    { name: "Ebenezer Medical Centre", city: "Aizawl", state: "Mizoram", type: "hospital" },
    { name: "Trinity Diagnostic & Hospital", city: "Aizawl", state: "Mizoram", type: "hospital" },

    /* ==================== NAGALAND ==================== */
    { name: "Naga Hospital Authority Kohima", city: "Kohima", state: "Nagaland", type: "hospital" },
    { name: "Nagaland Institute of Medical Sciences & Research (NIMSR)", city: "Kohima", state: "Nagaland", type: "medical_college" },
    { name: "Christian Institute of Health Sciences & Research (CIHSR)", city: "Dimapur", state: "Nagaland", type: "medical_college" },
    { name: "District Hospital Dimapur", city: "Dimapur", state: "Nagaland", type: "hospital" },
    { name: "Zion Hospital & Research Centre", city: "Dimapur", state: "Nagaland", type: "hospital" },
    { name: "Eden Medical Centre", city: "Dimapur", state: "Nagaland", type: "hospital" },

    /* ==================== ODISHA ==================== */
    { name: "All India Institute of Medical Sciences (AIIMS), Bhubaneswar", city: "Bhubaneswar", state: "Odisha", type: "medical_college" },
    { name: "Sriram Chandra Bhanja Medical College & Hospital (SCB)", city: "Cuttack", state: "Odisha", type: "medical_college" },
    { name: "Kalinga Institute of Medical Sciences (KIMS)", city: "Bhubaneswar", state: "Odisha", type: "medical_college" },
    { name: "Institute of Medical Sciences & SUM Hospital", city: "Bhubaneswar", state: "Odisha", type: "medical_college" },
    { name: "Maharaja Krushna Chandra Gajapati Medical College (MKCG)", city: "Berhampur", state: "Odisha", type: "medical_college" },
    { name: "Veer Surendra Sai Institute of Medical Sciences & Research (VIMSAR)", city: "Sambalpur (Burla)", state: "Odisha", type: "medical_college" },
    { name: "Capital Hospital", city: "Bhubaneswar", state: "Odisha", type: "hospital" },
    { name: "Apollo Hospitals, Bhubaneswar", city: "Bhubaneswar", state: "Odisha", type: "hospital" },
    { name: "AMRI Hospital, Bhubaneswar", city: "Bhubaneswar", state: "Odisha", type: "hospital" },
    { name: "Acharya Harihar Post Graduate Institute of Cancer", city: "Cuttack", state: "Odisha", type: "hospital" },
    { name: "Hi-Tech Medical College & Hospital", city: "Bhubaneswar", state: "Odisha", type: "medical_college" },
    { name: "Bhima Bhoi Medical College & Hospital", city: "Balangir", state: "Odisha", type: "medical_college" },

    /* ==================== PUNJAB ==================== */
    { name: "Government Medical College, Patiala (Rajindra Hospital)", city: "Patiala", state: "Punjab", type: "medical_college" },
    { name: "Government Medical College, Amritsar", city: "Amritsar", state: "Punjab", type: "medical_college" },
    { name: "Christian Medical College & Hospital, Ludhiana", city: "Ludhiana", state: "Punjab", type: "medical_college" },
    { name: "Dayanand Medical College & Hospital (DMCH)", city: "Ludhiana", state: "Punjab", type: "medical_college" },
    { name: "Guru Gobind Singh Medical College & Hospital", city: "Faridkot", state: "Punjab", type: "medical_college" },
    { name: "Sri Guru Ram Das Institute of Medical Sciences & Research", city: "Amritsar", state: "Punjab", type: "medical_college" },
    { name: "Adesh Institute of Medical Sciences & Research", city: "Bathinda", state: "Punjab", type: "medical_college" },
    { name: "AIIMS Bathinda", city: "Bathinda", state: "Punjab", type: "medical_college" },
    { name: "Fortis Hospital, Mohali", city: "Mohali", state: "Punjab", type: "hospital" },
    { name: "Max Super Speciality Hospital, Mohali (Bathinda)", city: "Mohali", state: "Punjab", type: "hospital" },
    { name: "Amandeep Hospital", city: "Amritsar", state: "Punjab", type: "hospital" },
    { name: "Deepak Hospital", city: "Ludhiana", state: "Punjab", type: "hospital" },
    { name: "Ivy Hospital", city: "Mohali", state: "Punjab", type: "hospital" },

    /* ==================== RAJASTHAN ==================== */
    { name: "Sawai Man Singh (SMS) Medical College & Hospital", city: "Jaipur", state: "Rajasthan", type: "medical_college" },
    { name: "Dr. Sampurnanand Medical College (Mathuradas Mathur Hospital)", city: "Jodhpur", state: "Rajasthan", type: "medical_college" },
    { name: "AIIMS Jodhpur", city: "Jodhpur", state: "Rajasthan", type: "medical_college" },
    { name: "Rabindranath Tagore Medical College & MB Hospital", city: "Udaipur", state: "Rajasthan", type: "medical_college" },
    { name: "Jawaharlal Nehru Medical College, Ajmer", city: "Ajmer", state: "Rajasthan", type: "medical_college" },
    { name: "Sardar Patel Medical College", city: "Bikaner", state: "Rajasthan", type: "medical_college" },
    { name: "Government Medical College, Kota", city: "Kota", state: "Rajasthan", type: "medical_college" },
    { name: "Fortis Escorts Hospital, Jaipur", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "Eternal Heart Care Centre & Research Institute", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "Narayana Multispeciality Hospital, Jaipur", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "Manipal Hospital, Jaipur", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "Bhagwan Mahaveer Cancer Hospital & Research Centre", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "Geetanjali Medical College & Hospital", city: "Udaipur", state: "Rajasthan", type: "medical_college" },
    { name: "Mahatma Gandhi Medical College & Hospital", city: "Jaipur", state: "Rajasthan", type: "medical_college" },

    /* ==================== SIKKIM ==================== */
    { name: "Sikkim Manipal Institute of Medical Sciences (Central Referral Hospital)", city: "Gangtok", state: "Sikkim", type: "medical_college" },
    { name: "Sir Thutob Namgyal Memorial (STNM) Hospital", city: "Gangtok", state: "Sikkim", type: "hospital" },
    { name: "New STNM Multi Speciality Hospital", city: "Gangtok (Sochakgang)", state: "Sikkim", type: "hospital" },
    { name: "District Hospital, Namchi", city: "Namchi", state: "Sikkim", type: "hospital" },
    { name: "Singtam District Hospital", city: "Singtam", state: "Sikkim", type: "hospital" },

    /* ==================== TAMIL NADU ==================== */
    { name: "Madras Medical College & Rajiv Gandhi Government General Hospital", city: "Chennai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Stanley Medical College & Hospital", city: "Chennai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Kilpauk Medical College", city: "Chennai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Sri Ramachandra Medical College & Research Institute", city: "Chennai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Christian Medical College (CMC), Vellore", city: "Vellore", state: "Tamil Nadu", type: "medical_college" },
    { name: "Apollo Hospitals, Greams Road", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "MIOT International", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Fortis Malar Hospital", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Madras Institute of Orthopaedics & Traumatology (MIOT)", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Madurai Medical College & Government Rajaji Hospital", city: "Madurai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Coimbatore Medical College & Hospital", city: "Coimbatore", state: "Tamil Nadu", type: "medical_college" },
    { name: "PSG Institute of Medical Sciences & Research", city: "Coimbatore", state: "Tamil Nadu", type: "medical_college" },
    { name: "Kovai Medical Center & Hospital (KMCH)", city: "Coimbatore", state: "Tamil Nadu", type: "hospital" },
    { name: "Thanjavur Medical College", city: "Thanjavur", state: "Tamil Nadu", type: "medical_college" },
    { name: "Tirunelveli Medical College", city: "Tirunelveli", state: "Tamil Nadu", type: "medical_college" },
    { name: "Meenakshi Mission Hospital & Research Centre", city: "Madurai", state: "Tamil Nadu", type: "hospital" },

    /* ==================== TELANGANA ==================== */
    { name: "Osmania Medical College & Osmania General Hospital", city: "Hyderabad", state: "Telangana", type: "medical_college" },
    { name: "Gandhi Medical College & Hospital", city: "Secunderabad", state: "Telangana", type: "medical_college" },
    { name: "Nizam's Institute of Medical Sciences (NIMS)", city: "Hyderabad", state: "Telangana", type: "medical_college" },
    { name: "Kakatiya Medical College & MGM Hospital", city: "Warangal", state: "Telangana", type: "medical_college" },
    { name: "Apollo Hospitals, Jubilee Hills", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Care Hospitals, Banjara Hills", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Yashoda Hospitals", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "KIMS Hospitals (Krishna Institute of Medical Sciences)", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Continental Hospitals", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "AIG Hospitals (Asian Institute of Gastroenterology)", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Basavatarakam Indo-American Cancer Hospital & Research Institute", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Sunshine Hospitals", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "ESIC Medical College & Hospital, Sanathnagar", city: "Hyderabad", state: "Telangana", type: "medical_college" },
    { name: "Rajiv Gandhi Institute of Medical Sciences (RIMS), Adilabad", city: "Adilabad", state: "Telangana", type: "medical_college" },

    /* ==================== TRIPURA ==================== */
    { name: "Agartala Government Medical College & GBP Hospital", city: "Agartala", state: "Tripura", type: "medical_college" },
    { name: "Tripura Medical College & Dr. BRAM Teaching Hospital", city: "Agartala (Hapania)", state: "Tripura", type: "medical_college" },
    { name: "ILS Hospitals, Agartala", city: "Agartala", state: "Tripura", type: "hospital" },
    { name: "Tripura Sundari District Hospital", city: "Udaipur", state: "Tripura", type: "hospital" },
    { name: "District Hospital, Dharmanagar", city: "Dharmanagar", state: "Tripura", type: "hospital" },

    /* ==================== UTTAR PRADESH ==================== */
    { name: "King George's Medical University (KGMU)", city: "Lucknow", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Sanjay Gandhi Postgraduate Institute of Medical Sciences (SGPGIMS)", city: "Lucknow", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Dr. Ram Manohar Lohia Institute of Medical Sciences (RMLIMS)", city: "Lucknow", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Institute of Medical Sciences, Banaras Hindu University (IMS-BHU)", city: "Varanasi", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Jawaharlal Nehru Medical College, Aligarh Muslim University (JNMC-AMU)", city: "Aligarh", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Sarojini Naidu Medical College", city: "Agra", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Ganesh Shankar Vidyarthi Memorial (GSVM) Medical College", city: "Kanpur", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Baba Raghav Das Medical College", city: "Gorakhpur", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Motilal Nehru Medical College", city: "Prayagraj", state: "Uttar Pradesh", type: "medical_college" },
    { name: "AIIMS Gorakhpur", city: "Gorakhpur", state: "Uttar Pradesh", type: "medical_college" },
    { name: "AIIMS Rae Bareli", city: "Rae Bareli", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Apollomedics Super Speciality Hospital", city: "Lucknow", state: "Uttar Pradesh", type: "hospital" },
    { name: "Medanta Hospital, Lucknow", city: "Lucknow", state: "Uttar Pradesh", type: "hospital" },
    { name: "Yatharth Super Speciality Hospital", city: "Noida", state: "Uttar Pradesh", type: "hospital" },
    { name: "Fortis Hospital, Noida", city: "Noida", state: "Uttar Pradesh", type: "hospital" },
    { name: "Kailash Hospital", city: "Noida", state: "Uttar Pradesh", type: "hospital" },

    /* ==================== UTTARAKHAND ==================== */
    { name: "All India Institute of Medical Sciences (AIIMS), Rishikesh", city: "Rishikesh", state: "Uttarakhand", type: "medical_college" },
    { name: "Government Doon Medical College", city: "Dehradun", state: "Uttarakhand", type: "medical_college" },
    { name: "Government Medical College, Haldwani (Dr. Sushila Tiwari Hospital)", city: "Haldwani", state: "Uttarakhand", type: "medical_college" },
    { name: "Himalayan Institute of Medical Sciences (SRHU)", city: "Dehradun (Jolly Grant)", state: "Uttarakhand", type: "medical_college" },
    { name: "Max Super Speciality Hospital, Dehradun", city: "Dehradun", state: "Uttarakhand", type: "hospital" },
    { name: "Synergy Institute of Medical Sciences", city: "Dehradun", state: "Uttarakhand", type: "hospital" },
    { name: "Kailash Hospital, Dehradun", city: "Dehradun", state: "Uttarakhand", type: "hospital" },
    { name: "Government Medical College, Srinagar (Garhwal)", city: "Srinagar (Garhwal)", state: "Uttarakhand", type: "medical_college" },
    { name: "Combined Hospital, Haridwar", city: "Haridwar", state: "Uttarakhand", type: "hospital" },

    /* ==================== WEST BENGAL ==================== */
    { name: "Medical College & Hospital, Kolkata", city: "Kolkata", state: "West Bengal", type: "medical_college" },
    { name: "Institute of Post Graduate Medical Education & Research (IPGMER / SSKM Hospital)", city: "Kolkata", state: "West Bengal", type: "medical_college" },
    { name: "R. G. Kar Medical College & Hospital", city: "Kolkata", state: "West Bengal", type: "medical_college" },
    { name: "Nil Ratan Sircar Medical College & Hospital (NRS)", city: "Kolkata", state: "West Bengal", type: "medical_college" },
    { name: "Calcutta National Medical College", city: "Kolkata", state: "West Bengal", type: "medical_college" },
    { name: "Bangur Institute of Neurosciences", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Chittaranjan National Cancer Institute (CNCI)", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Apollo Multispeciality Hospitals (Apollo Gleneagles)", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "AMRI Hospitals, Dhakuria", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Fortis Hospital, Anandapur", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Medica Superspecialty Hospital", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Peerless Hospital & B. K. Roy Research Centre", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Burdwan Medical College & Hospital", city: "Bardhaman", state: "West Bengal", type: "medical_college" },
    { name: "North Bengal Medical College & Hospital", city: "Siliguri", state: "West Bengal", type: "medical_college" },
    { name: "Midnapore Medical College & Hospital", city: "Midnapore", state: "West Bengal", type: "medical_college" },

    /* ==================== JAMMU & KASHMIR (UT) ==================== */
    { name: "Sher-i-Kashmir Institute of Medical Sciences (SKIMS), Soura", city: "Srinagar", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Srinagar", city: "Srinagar", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Jammu", city: "Jammu", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Lalla Ded Hospital", city: "Srinagar", state: "Jammu & Kashmir", type: "hospital" },
    { name: "Shri Maharaja Gulab Singh (SMGS) Hospital", city: "Jammu", state: "Jammu & Kashmir", type: "hospital" },
    { name: "AIIMS Vijaypur (Jammu)", city: "Samba (Vijaypur)", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Anantnag", city: "Anantnag", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Baramulla", city: "Baramulla", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Acharya Shri Chander College of Medical Sciences (ASCOMS)", city: "Jammu", state: "Jammu & Kashmir", type: "medical_college" },

    /* ==================== LADAKH (UT) ==================== */
    { name: "Sonam Norboo Memorial (SNM) Hospital", city: "Leh", state: "Ladakh", type: "hospital" },
    { name: "District Hospital, Kargil", city: "Kargil", state: "Ladakh", type: "hospital" },

    /* ==================== CHANDIGARH (UT) ==================== */
    { name: "Postgraduate Institute of Medical Education & Research (PGIMER)", city: "Chandigarh", state: "Chandigarh", type: "medical_college" },
    { name: "Government Medical College & Hospital, Sector 32 (GMCH)", city: "Chandigarh", state: "Chandigarh", type: "medical_college" },
    { name: "Government Multi Specialty Hospital, Sector 16", city: "Chandigarh", state: "Chandigarh", type: "hospital" },
    { name: "National Institute of Nursing Education (PGIMER)", city: "Chandigarh", state: "Chandigarh", type: "hospital" },
    { name: "Alchemist Hospital, Panchkula (Zirakpur)", city: "Chandigarh (Zirakpur)", state: "Chandigarh", type: "hospital" },

    /* ==================== PUDUCHERRY (UT) ==================== */
    { name: "Jawaharlal Institute of Postgraduate Medical Education & Research (JIPMER)", city: "Puducherry", state: "Puducherry", type: "medical_college" },
    { name: "Mahatma Gandhi Medical College & Research Institute (MGMCRI)", city: "Puducherry", state: "Puducherry", type: "medical_college" },
    { name: "Sri Manakula Vinayagar Medical College & Hospital", city: "Puducherry", state: "Puducherry", type: "medical_college" },
    { name: "Pondicherry Institute of Medical Sciences (PIMS)", city: "Puducherry", state: "Puducherry", type: "medical_college" },
    { name: "Indira Gandhi Government General Hospital & Post Graduate Institute", city: "Puducherry", state: "Puducherry", type: "hospital" },
    { name: "Aarupadai Veedu Medical College & Hospital", city: "Puducherry (Kirumampakkam)", state: "Puducherry", type: "medical_college" },

    /* ==================== ANDAMAN & NICOBAR ISLANDS (UT) ==================== */
    { name: "Andaman & Nicobar Islands Institute of Medical Sciences (ANIIMS) / GB Pant Hospital", city: "Port Blair", state: "Andaman & Nicobar Islands", type: "medical_college" },
    { name: "District Hospital, Car Nicobar", city: "Car Nicobar", state: "Andaman & Nicobar Islands", type: "hospital" },
    { name: "Dr. R. P. Government Medical College Hospital", city: "Port Blair", state: "Andaman & Nicobar Islands", type: "hospital" },

    /* ==================== DADRA & NAGAR HAVELI AND DAMAN & DIU (UT) ==================== */
    { name: "Shri Vinoba Bhave Civil Hospital", city: "Silvassa", state: "Dadra & Nagar Haveli and Daman & Diu", type: "hospital" },
    { name: "NAMO Medical Education & Research Institute", city: "Silvassa", state: "Dadra & Nagar Haveli and Daman & Diu", type: "medical_college" },
    { name: "Government Hospital, Daman (Marwad)", city: "Daman", state: "Dadra & Nagar Haveli and Daman & Diu", type: "hospital" },
    { name: "Community Health Centre, Diu", city: "Diu", state: "Dadra & Nagar Haveli and Daman & Diu", type: "hospital" },

    /* ==================== LAKSHADWEEP (UT) ==================== */
    { name: "Indira Gandhi Hospital, Kavaratti", city: "Kavaratti", state: "Lakshadweep", type: "hospital" },
    { name: "Community Health Centre, Andrott", city: "Andrott", state: "Lakshadweep", type: "hospital" },

    /* ================================================================== *
     * SUPPLEMENTAL — additional recognizable hospitals & medical colleges
     * (grouped by state; includes newer AIIMS and major private/corporate
     * chains). Merged into the master list above; deduplicated at runtime.
     * ================================================================== */

    /* ---- Delhi (NCT) ---- */
    { name: "Holy Family Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "St. Stephen's Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Batra Hospital & Medical Research Centre", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Moolchand Medcity", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "National Heart Institute", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Army Hospital (Research & Referral), Delhi Cantt", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Kalawati Saran Children's Hospital", city: "New Delhi", state: "Delhi", type: "hospital" },
    { name: "Chacha Nehru Bal Chikitsalaya", city: "New Delhi", state: "Delhi", type: "hospital" },

    /* ---- Andhra Pradesh ---- */
    { name: "AIIMS Mangalagiri", city: "Mangalagiri (Guntur)", state: "Andhra Pradesh", type: "medical_college" },
    { name: "GSL Medical College & General Hospital", city: "Rajahmundry", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Great Eastern Medical School & Hospital", city: "Srikakulam", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Narayana Medical College & Hospital", city: "Nellore", state: "Andhra Pradesh", type: "medical_college" },
    { name: "ACSR Government Medical College", city: "Nellore", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Government Medical College, Anantapur", city: "Anantapur", state: "Andhra Pradesh", type: "medical_college" },
    { name: "Ramesh Hospitals", city: "Vijayawada", state: "Andhra Pradesh", type: "hospital" },
    { name: "Queen's NRI Hospital", city: "Visakhapatnam", state: "Andhra Pradesh", type: "hospital" },
    { name: "Seven Hills Hospital", city: "Visakhapatnam", state: "Andhra Pradesh", type: "hospital" },

    /* ---- Assam ---- */
    { name: "Lakhimpur Medical College & Hospital", city: "North Lakhimpur", state: "Assam", type: "medical_college" },
    { name: "Kokrajhar Medical College & Hospital", city: "Kokrajhar", state: "Assam", type: "medical_college" },
    { name: "Nalbari Medical College & Hospital", city: "Nalbari", state: "Assam", type: "medical_college" },
    { name: "Marwari Hospitals", city: "Guwahati", state: "Assam", type: "hospital" },
    { name: "International Hospital", city: "Guwahati", state: "Assam", type: "hospital" },

    /* ---- Bihar ---- */
    { name: "Jannayak Karpoori Thakur Medical College & Hospital", city: "Madhepura", state: "Bihar", type: "medical_college" },
    { name: "Katihar Medical College", city: "Katihar", state: "Bihar", type: "medical_college" },
    { name: "Mata Gujri Memorial Medical College", city: "Kishanganj", state: "Bihar", type: "medical_college" },
    { name: "Narayan Medical College & Hospital", city: "Sasaram", state: "Bihar", type: "medical_college" },
    { name: "Big Apollo Spectra Hospitals", city: "Patna", state: "Bihar", type: "hospital" },
    { name: "Medanta Hospital, Patna", city: "Patna", state: "Bihar", type: "hospital" },

    /* ---- Chhattisgarh ---- */
    { name: "Government Medical College, Ambikapur", city: "Ambikapur", state: "Chhattisgarh", type: "medical_college" },
    { name: "Late Baliram Kashyap Memorial Government Medical College", city: "Jagdalpur", state: "Chhattisgarh", type: "medical_college" },
    { name: "Chandulal Chandrakar Memorial Medical College", city: "Durg", state: "Chhattisgarh", type: "medical_college" },
    { name: "MMI Narayana Superspeciality Hospital", city: "Raipur", state: "Chhattisgarh", type: "hospital" },

    /* ---- Goa ---- */
    { name: "Asilo Hospital", city: "Mapusa", state: "Goa", type: "hospital" },
    { name: "Cottage Hospital, Chicalim", city: "Chicalim", state: "Goa", type: "hospital" },

    /* ---- Gujarat ---- */
    { name: "AIIMS Rajkot (Gujarat)", city: "Rajkot", state: "Gujarat", type: "medical_college" },
    { name: "GCS Medical College, Hospital & Research Centre", city: "Ahmedabad", state: "Gujarat", type: "medical_college" },
    { name: "Smt. NHL Municipal Medical College", city: "Ahmedabad", state: "Gujarat", type: "medical_college" },
    { name: "Surat Municipal Institute of Medical Education & Research (SMIMER)", city: "Surat", state: "Gujarat", type: "medical_college" },
    { name: "Pramukhswami Medical College & Shree Krishna Hospital", city: "Karamsad (Anand)", state: "Gujarat", type: "medical_college" },
    { name: "HCG Cancer Centre, Ahmedabad", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Shalby Hospitals", city: "Ahmedabad", state: "Gujarat", type: "hospital" },
    { name: "Narayana Multispeciality Hospital, Ahmedabad", city: "Ahmedabad", state: "Gujarat", type: "hospital" },

    /* ---- Haryana ---- */
    { name: "ESIC Medical College & Hospital, Faridabad", city: "Faridabad", state: "Haryana", type: "medical_college" },
    { name: "SGT Medical College, Hospital & Research Institute", city: "Gurugram", state: "Haryana", type: "medical_college" },
    { name: "National Cancer Institute (AIIMS Jhajjar)", city: "Jhajjar", state: "Haryana", type: "hospital" },
    { name: "Metro Heart Institute with Multispeciality", city: "Faridabad", state: "Haryana", type: "hospital" },
    { name: "Manipal Hospital, Gurugram", city: "Gurugram", state: "Haryana", type: "hospital" },
    { name: "Marengo Asia Hospitals", city: "Gurugram", state: "Haryana", type: "hospital" },

    /* ---- Himachal Pradesh ---- */
    { name: "Government Medical College, Nahan", city: "Nahan (Sirmaur)", state: "Himachal Pradesh", type: "medical_college" },
    { name: "Regional Hospital, Solan", city: "Solan", state: "Himachal Pradesh", type: "hospital" },

    /* ---- Jharkhand ---- */
    { name: "Manipal Tata Medical College", city: "Jamshedpur", state: "Jharkhand", type: "medical_college" },
    { name: "AIIMS Deoghar", city: "Deoghar", state: "Jharkhand", type: "medical_college" },
    { name: "Orchid Medical Centre", city: "Ranchi", state: "Jharkhand", type: "hospital" },
    { name: "Sadar Hospital, Ranchi", city: "Ranchi", state: "Jharkhand", type: "hospital" },

    /* ---- Karnataka ---- */
    { name: "Bangalore Baptist Hospital", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Aster CMI Hospital", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "HealthCare Global (HCG) Cancer Centre", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Fortis Hospital, Bannerghatta Road", city: "Bengaluru", state: "Karnataka", type: "hospital" },
    { name: "Vydehi Institute of Medical Sciences & Research Centre", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "Kempegowda Institute of Medical Sciences (KIMS)", city: "Bengaluru", state: "Karnataka", type: "medical_college" },
    { name: "SDM College of Medical Sciences & Hospital", city: "Dharwad", state: "Karnataka", type: "medical_college" },
    { name: "Shri B. M. Patil Medical College (BLDE)", city: "Vijayapura", state: "Karnataka", type: "medical_college" },
    { name: "JJM Medical College", city: "Davangere", state: "Karnataka", type: "medical_college" },
    { name: "Father Muller Medical College", city: "Mangaluru", state: "Karnataka", type: "medical_college" },
    { name: "Yenepoya Medical College", city: "Mangaluru", state: "Karnataka", type: "medical_college" },

    /* ---- Kerala ---- */
    { name: "Government Medical College, Alappuzha (T. D. Medical College)", city: "Alappuzha", state: "Kerala", type: "medical_college" },
    { name: "Government Medical College, Ernakulam", city: "Kochi (Kalamassery)", state: "Kerala", type: "medical_college" },
    { name: "Government Medical College, Kannur (Pariyaram)", city: "Kannur (Pariyaram)", state: "Kerala", type: "medical_college" },
    { name: "Baby Memorial Hospital", city: "Kozhikode", state: "Kerala", type: "hospital" },
    { name: "SUT Hospital, Pattom", city: "Thiruvananthapuram", state: "Kerala", type: "hospital" },
    { name: "Sree Gokulam Medical College & Research Foundation", city: "Thiruvananthapuram", state: "Kerala", type: "medical_college" },

    /* ---- Madhya Pradesh ---- */
    { name: "Bundelkhand Medical College", city: "Sagar", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Atal Bihari Vajpayee Government Medical College", city: "Vidisha", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Government Medical College, Ratlam", city: "Ratlam", state: "Madhya Pradesh", type: "medical_college" },
    { name: "People's College of Medical Sciences & Research Centre", city: "Bhopal", state: "Madhya Pradesh", type: "medical_college" },
    { name: "Vishesh Jupiter Hospital", city: "Indore", state: "Madhya Pradesh", type: "hospital" },

    /* ---- Maharashtra ---- */
    { name: "AIIMS Nagpur", city: "Nagpur", state: "Maharashtra", type: "medical_college" },
    { name: "Dr. D. Y. Patil Medical College, Hospital & Research Centre", city: "Pune", state: "Maharashtra", type: "medical_college" },
    { name: "Bharati Vidyapeeth Medical College & Hospital", city: "Pune", state: "Maharashtra", type: "medical_college" },
    { name: "Deenanath Mangeshkar Hospital & Research Centre", city: "Pune", state: "Maharashtra", type: "hospital" },
    { name: "Jehangir Hospital", city: "Pune", state: "Maharashtra", type: "hospital" },
    { name: "Sahyadri Super Speciality Hospital", city: "Pune", state: "Maharashtra", type: "hospital" },
    { name: "Fortis Hospital, Mulund", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Wockhardt Hospitals", city: "Mumbai", state: "Maharashtra", type: "hospital" },
    { name: "Mahatma Gandhi Mission (MGM) Medical College", city: "Navi Mumbai", state: "Maharashtra", type: "medical_college" },
    { name: "Dr. Vaishampayan Memorial Government Medical College", city: "Solapur", state: "Maharashtra", type: "medical_college" },
    { name: "Government Medical College, Miraj", city: "Miraj", state: "Maharashtra", type: "medical_college" },
    { name: "Indira Gandhi Government Medical College", city: "Nagpur", state: "Maharashtra", type: "medical_college" },

    /* ---- Manipur ---- */
    { name: "Churachandpur Medical College", city: "Churachandpur", state: "Manipur", type: "medical_college" },
    { name: "Babina Diagnostics & Hospital", city: "Imphal", state: "Manipur", type: "hospital" },

    /* ---- Meghalaya ---- */
    { name: "Bethany Hospital", city: "Shillong", state: "Meghalaya", type: "hospital" },
    { name: "Supercare Hospital", city: "Shillong", state: "Meghalaya", type: "hospital" },

    /* ---- Odisha ---- */
    { name: "Fakir Mohan Medical College & Hospital", city: "Balasore", state: "Odisha", type: "medical_college" },
    { name: "Saheed Laxman Nayak Medical College & Hospital", city: "Koraput", state: "Odisha", type: "medical_college" },
    { name: "Kalinga Hospital", city: "Bhubaneswar", state: "Odisha", type: "hospital" },
    { name: "Care Hospital, Bhubaneswar", city: "Bhubaneswar", state: "Odisha", type: "hospital" },

    /* ---- Punjab ---- */
    { name: "Government Medical College, Mohali (Dr. B. R. Ambedkar Institute)", city: "Mohali", state: "Punjab", type: "medical_college" },
    { name: "Punjab Institute of Medical Sciences", city: "Jalandhar", state: "Punjab", type: "medical_college" },
    { name: "Gian Sagar Medical College & Hospital", city: "Patiala (Banur)", state: "Punjab", type: "medical_college" },
    { name: "Fortis Hospital, Ludhiana", city: "Ludhiana", state: "Punjab", type: "hospital" },
    { name: "SPS Hospitals", city: "Ludhiana", state: "Punjab", type: "hospital" },

    /* ---- Rajasthan ---- */
    { name: "Government Medical College, Bharatpur", city: "Bharatpur", state: "Rajasthan", type: "medical_college" },
    { name: "Government Medical College, Pali", city: "Pali", state: "Rajasthan", type: "medical_college" },
    { name: "Jhalawar Medical College", city: "Jhalawar", state: "Rajasthan", type: "medical_college" },
    { name: "National Institute of Medical Sciences (NIMS) University", city: "Jaipur", state: "Rajasthan", type: "medical_college" },
    { name: "Santokba Durlabhji Memorial Hospital (SDMH)", city: "Jaipur", state: "Rajasthan", type: "hospital" },
    { name: "CK Birla Hospitals (Rukmani Birla Hospital)", city: "Jaipur", state: "Rajasthan", type: "hospital" },

    /* ---- Tamil Nadu ---- */
    { name: "AIIMS Madurai", city: "Madurai", state: "Tamil Nadu", type: "medical_college" },
    { name: "Chengalpattu Medical College", city: "Chengalpattu", state: "Tamil Nadu", type: "medical_college" },
    { name: "Government Mohan Kumaramangalam Medical College", city: "Salem", state: "Tamil Nadu", type: "medical_college" },
    { name: "SRM Medical College Hospital & Research Centre", city: "Kattankulathur (Chengalpattu)", state: "Tamil Nadu", type: "medical_college" },
    { name: "Saveetha Medical College & Hospital", city: "Chennai (Thandalam)", state: "Tamil Nadu", type: "medical_college" },
    { name: "Chettinad Hospital & Research Institute", city: "Chennai (Kelambakkam)", state: "Tamil Nadu", type: "medical_college" },
    { name: "Kauvery Hospital", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Gleneagles Global Health City", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Vijaya Hospital", city: "Chennai", state: "Tamil Nadu", type: "hospital" },
    { name: "Tirunelveli Medical College Hospital", city: "Tirunelveli", state: "Tamil Nadu", type: "hospital" },

    /* ---- Telangana ---- */
    { name: "AIIMS Bibinagar", city: "Bibinagar (Yadadri)", state: "Telangana", type: "medical_college" },
    { name: "Government Medical College, Nizamabad", city: "Nizamabad", state: "Telangana", type: "medical_college" },
    { name: "Kamineni Institute of Medical Sciences", city: "Narketpally (Nalgonda)", state: "Telangana", type: "medical_college" },
    { name: "Deccan College of Medical Sciences", city: "Hyderabad", state: "Telangana", type: "medical_college" },
    { name: "Star Hospitals", city: "Hyderabad", state: "Telangana", type: "hospital" },
    { name: "Medicover Hospitals", city: "Hyderabad", state: "Telangana", type: "hospital" },

    /* ---- Tripura ---- */
    { name: "Regional Cancer Centre, Agartala", city: "Agartala", state: "Tripura", type: "hospital" },

    /* ---- Uttar Pradesh ---- */
    { name: "AIIMS Rae Bareli (Uttar Pradesh)", city: "Rae Bareli", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Uttar Pradesh University of Medical Sciences (UPUMS), Saifai", city: "Saifai (Etawah)", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Maharani Laxmi Bai Medical College", city: "Jhansi", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Government Institute of Medical Sciences (GIMS), Greater Noida", city: "Greater Noida", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Sharda Hospital (School of Medical Sciences & Research)", city: "Greater Noida", state: "Uttar Pradesh", type: "medical_college" },
    { name: "Regency Hospital", city: "Kanpur", state: "Uttar Pradesh", type: "hospital" },
    { name: "Santosh Medical College & Hospital", city: "Ghaziabad", state: "Uttar Pradesh", type: "medical_college" },

    /* ---- Uttarakhand ---- */
    { name: "Shri Mahant Indiresh Hospital (SGRR University)", city: "Dehradun", state: "Uttarakhand", type: "medical_college" },
    { name: "Government Medical College, Almora (Soban Singh Jeena)", city: "Almora", state: "Uttarakhand", type: "medical_college" },
    { name: "CMI Hospital", city: "Dehradun", state: "Uttarakhand", type: "hospital" },

    /* ---- West Bengal ---- */
    { name: "AIIMS Kalyani", city: "Kalyani (Nadia)", state: "West Bengal", type: "medical_college" },
    { name: "Bankura Sammilani Medical College & Hospital", city: "Bankura", state: "West Bengal", type: "medical_college" },
    { name: "College of Medicine & Sagore Dutta Hospital", city: "Kamarhati (Kolkata)", state: "West Bengal", type: "medical_college" },
    { name: "Malda Medical College & Hospital", city: "Malda", state: "West Bengal", type: "medical_college" },
    { name: "Murshidabad Medical College & Hospital", city: "Berhampore", state: "West Bengal", type: "medical_college" },
    { name: "Tata Medical Center", city: "Kolkata (New Town)", state: "West Bengal", type: "hospital" },
    { name: "B. M. Birla Heart Research Centre", city: "Kolkata", state: "West Bengal", type: "hospital" },
    { name: "Woodlands Multispeciality Hospital", city: "Kolkata", state: "West Bengal", type: "hospital" },

    /* ---- Jammu & Kashmir ---- */
    { name: "SKIMS Medical College, Bemina", city: "Srinagar", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Rajouri", city: "Rajouri", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Government Medical College, Doda", city: "Doda", state: "Jammu & Kashmir", type: "medical_college" },
    { name: "Bone & Joint Hospital", city: "Srinagar", state: "Jammu & Kashmir", type: "hospital" },

    /* ---- Puducherry ---- */
    { name: "Indira Gandhi Medical College & Research Institute (IGMCRI)", city: "Puducherry", state: "Puducherry", type: "medical_college" },
    { name: "Vinayaka Mission's Medical College", city: "Karaikal", state: "Puducherry", type: "medical_college" }

  ];

  /* ------------------------------------------------------------------ *
   * Dedup on name + city + state (defensive; source is hand-curated).
   * ------------------------------------------------------------------ */
  var seen = {};
  var deduped = [];
  for (var i = 0; i < HOSPITALS.length; i++) {
    var h = HOSPITALS[i];
    var key = (h.name + "|" + h.city + "|" + h.state).toLowerCase();
    if (seen[key]) { continue; }
    seen[key] = true;
    deduped.push(h);
  }
  HOSPITALS = deduped;

  window.SMD_HOSPITALS = {
    all: function () { return HOSPITALS.slice(); },
    search: function (q) {
      q = (q || "").toLowerCase().trim();
      if (!q) { return HOSPITALS.slice(0, 50); }
      return HOSPITALS.filter(function (h) {
        return (h.name + " " + h.city + " " + h.state).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 60);
    },
    byState: function (s) {
      s = (s || "").toLowerCase().trim();
      if (!s) { return []; }
      return HOSPITALS.filter(function (h) {
        return h.state.toLowerCase() === s;
      });
    },
    states: function () {
      var set = {};
      var out = [];
      for (var i = 0; i < HOSPITALS.length; i++) {
        var st = HOSPITALS[i].state;
        if (!set[st]) { set[st] = true; out.push(st); }
      }
      out.sort();
      return out;
    }
  };

})();
