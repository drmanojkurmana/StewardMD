/* functions/_wardsynq/leaflet-starter.js - the StewardMD starter set of patient education leaflets (owner decision
 * 2026-10-04): ten English DRAFTS a hospital may import, with one action, into its own leaflet library.
 *
 * DRAFTS, NEVER APPROVED. Nothing here reaches a patient. Importing (patient-education.js importStarterLeaflets) writes each
 * one into THAT hospital's library as a draft by the clinician who imported it, so the existing rule applies unchanged: a
 * SECOND clinician of that hospital, who wrote no part of it, approves the exact version they read, and only an approved
 * leaflet can be given on a discharge. Nothing is seeded into any hospital automatically. Each imported leaflet carries the
 * marker below on its record (not in the patient's text) so the library says where it came from.
 *
 * Written for Indian hospitals in plain English: short sentences, everyday foods and units, the emergency number 108, no
 * drug names with doses and no dose instructions (the treating doctor's prescription governs), a "come back to hospital if"
 * list in each, and no em dashes. The words are StewardMD's draft for the hospital's clinicians to correct, not a clinical
 * standard; a change here is a new version, and a hospital that imported the old one keeps its own copy.
 *
 * Review copy for the owner: .claude/jobs/.../clinical-content-scratch/leaflets-review.html (built from this file).
 */

export const STARTER_MARKER = "Draft prepared by StewardMD for your clinicians to review";

const leaflet = (templateId, title, tags, paragraphs) => Object.freeze({ templateId, title, tags: Object.freeze(tags), body: paragraphs.join("\n\n") });
const list = (items) => items.map((x) => "- " + x).join("\n");
const COME_BACK = "Come back to hospital, or call 108 for an ambulance, if:";

export const STARTER_LEAFLETS = Object.freeze({
  id: "stewardmd-starter-en",
  version: "2026-10-04",
  language: "en",
  marker: STARTER_MARKER,
  leaflets: Object.freeze([
    leaflet("wound-care-home", "Caring for your wound at home", ["wound", "surgery", "discharge"], [
      "This leaflet tells you how to look after your wound (cut, operation site or stitches) after you go home. Your doctor or nurse may give you extra advice. Follow their advice first.",
      "Keep it clean and dry",
      list([
        "Wash your hands with soap and water before and after you touch the dressing.",
        "Keep the dressing dry. Ask your nurse when you can bathe and when the dressing can get wet.",
        "Do not put oil, ghee, turmeric, ash, toothpaste or any home remedy on the wound.",
        "Do not pull at the stitches or pick at scabs.",
        "If the dressing gets wet or dirty, change it as your nurse showed you, or come to the hospital to get it changed.",
      ]),
      "Help it heal",
      list([
        "Eat normal home food with dal, eggs, milk, curd, paneer, fruits and vegetables. These help the skin heal.",
        "Drink enough water unless your doctor has told you to limit it.",
        "Do not smoke or chew tobacco. Smoking slows healing.",
        "If you have diabetes, keep your sugar under control. High sugar slows healing.",
        "Avoid heavy lifting and hard work until your doctor says it is safe.",
        "Take your medicines exactly as written on your prescription. Do not stop them early.",
      ]),
      "Stitches",
      "Your discharge papers say when and where your stitches or clips will be removed. Keep that appointment.",
      COME_BACK,
      list([
        "The wound becomes more red, swollen, hot or painful.",
        "Pus or a bad smell comes from the wound.",
        "The wound opens up.",
        "Bleeding does not stop after you press on it firmly for 10 minutes.",
        "You have fever, shivering or feel very unwell.",
      ]),
    ]),
    leaflet("urinary-catheter-home", "Caring for your urinary catheter at home", ["urinary catheter", "urology", "discharge"], [
      "A urinary catheter is a soft tube that drains urine from your bladder into a bag. This leaflet tells you how to look after it at home.",
      "Every day",
      list([
        "Wash your hands with soap and water before and after you touch the catheter or the bag.",
        "Wash the skin around the catheter once a day with mild soap and clean water. Dry it gently.",
        "Keep the bag below the level of your bladder, also when you sleep. Do not let it lie on the floor.",
        "Empty the bag when it is about half full, into the toilet. Do not let the tap touch the toilet or the floor.",
        "Keep the tube free of kinks and loops so urine can flow.",
        "Tape or strap the tube to your thigh so it does not pull.",
        "Drink enough water through the day unless your doctor has told you to limit it.",
      ]),
      "Things not to do",
      list([
        "Do not pull on the catheter or try to take it out yourself.",
        "Do not disconnect the bag from the catheter unless your nurse showed you how.",
        "Do not put powder or cream near the catheter.",
      ]),
      "Your discharge papers say when the catheter will be changed or removed. Keep that appointment.",
      COME_BACK,
      list([
        "No urine drains into the bag for several hours even though you are drinking.",
        "Urine leaks a lot around the catheter.",
        "The catheter comes out.",
        "Your urine has blood or clots in it, or smells very bad.",
        "You have fever, shivering, or pain in your lower tummy or back.",
      ]),
    ]),
    leaflet("diabetes-home", "Diabetes: looking after your blood sugar at home", ["diabetes", "blood sugar", "discharge"], [
      "Diabetes means the sugar in your blood is too high. Keeping it in control protects your eyes, kidneys, heart, nerves and feet.",
      "Medicines",
      list([
        "Take your tablets or insulin exactly as written on your prescription.",
        "Do not stop or change a medicine on your own, even if you feel well.",
        "If you take insulin, keep it as your nurse showed you, away from direct heat and sunlight.",
        "Before you fast for a festival or Ramzan, ask your doctor how to take your medicines.",
      ]),
      "Checking your sugar",
      list([
        "Check your sugar as often as your doctor told you.",
        "Write each reading in a notebook with the date and time. Bring the notebook to every visit.",
      ]),
      "Food",
      list([
        "Eat at regular times. Do not skip meals.",
        "Fill half your plate with vegetables. Eat dal, chana, rajma, eggs, fish or paneer.",
        "Eat smaller amounts of rice, roti, poha and other cereals. Choose whole grains such as jowar, bajra and ragi.",
        "Avoid sweets, sugar in tea, cold drinks, fruit juice and fried snacks.",
        "Walk every day if your doctor says it is safe.",
      ]),
      "Low sugar",
      "Low sugar can happen if you skip a meal or take too much medicine. Signs are sweating, shaking, hunger, a fast heartbeat, confusion or feeling faint. If this happens, take sugar, glucose powder or a sweet drink straight away. Then eat a meal. Tell your doctor at your next visit. Family members should know these signs.",
      "Your feet",
      "Look at your feet every day for cuts, blisters or colour change. Wear footwear inside and outside the house. Do not walk barefoot.",
      COME_BACK,
      list([
        "Low sugar signs do not get better after you take sugar, or the person is drowsy or cannot swallow.",
        "Your sugar stays much higher than your doctor told you to expect.",
        "You are vomiting and cannot eat or drink.",
        "You feel very thirsty, pass a lot of urine, or breathe fast and deep.",
        "A wound on your foot is red, swollen, has pus or turns black.",
      ]),
    ]),
    leaflet("warfarin", "Taking warfarin safely", ["warfarin", "anticoagulant", "blood thinner", "discharge"], [
      "Warfarin is a blood thinner. It helps stop harmful clots. Too much can cause bleeding. Too little may not protect you. This leaflet helps you take it safely.",
      "Taking it",
      list([
        "Take it at the same time every day, exactly as your doctor wrote. Your dose may change after each blood test.",
        "If you miss a dose, do not take two doses together. Ask your doctor or nurse what to do.",
        "Keep a written record of each dose and each blood test result.",
      ]),
      "Blood tests",
      "You need regular blood tests called INR or PT-INR. The result tells your doctor whether your dose is right. Go for every test on the date given to you.",
      "Food and other medicines",
      list([
        "Keep your diet steady. Green leafy vegetables such as palak, methi, sarson and cabbage change how warfarin works. You can eat them, but eat about the same amount every week. Do not suddenly start or stop them.",
        "Avoid alcohol.",
        "Do not take any new medicine, painkiller, herbal, Ayurvedic or homeopathic medicine without asking your doctor first. Many of these change how warfarin works.",
        "Tell every doctor, dentist and pharmacist that you take warfarin.",
      ]),
      "Daily care",
      "Use a soft toothbrush. Take care with knives and sharp tools. Tell your doctor if you plan to become pregnant.",
      COME_BACK,
      list([
        "You vomit blood, or your vomit looks like coffee grounds.",
        "Your stools are black or have blood in them.",
        "Your urine is red or dark brown.",
        "A nosebleed or a cut does not stop after you press on it firmly for 10 minutes.",
        "You have a bad headache, a fall or a head injury.",
        "You have large bruises you cannot explain.",
      ]),
    ]),
    leaflet("inhaler-use", "Using your inhaler", ["inhaler", "asthma", "COPD", "discharge"], [
      "An inhaler puts medicine straight into your lungs. It works only if you use it the right way. Ask your nurse to watch you use it before you go home.",
      "Using a puffer (metered dose inhaler)",
      list([
        "Take off the cap and shake the inhaler.",
        "Sit or stand up straight. Breathe out gently, away from the inhaler.",
        "Put the mouthpiece between your teeth and close your lips around it.",
        "Start to breathe in slowly and press the inhaler once at the same time.",
        "Keep breathing in slowly and deeply.",
        "Hold your breath for as long as is comfortable, then breathe out slowly.",
        "If you need another puff, wait a short while and repeat.",
      ]),
      "A spacer helps more medicine reach your lungs. Children and older people should use one. Your nurse can show you how.",
      "Using a dry powder inhaler (rotacap, capsule or disc type)",
      "Load the device as your nurse showed you. Breathe out away from it. Then breathe in quickly and deeply through it. Do not breathe out into the device.",
      "Good habits",
      list([
        "Use each inhaler exactly as written on your prescription. Some are used every day even when you feel well. Some are only for when you are breathless.",
        "After a steroid inhaler, rinse your mouth with water and spit it out.",
        "Keep the mouthpiece clean and dry.",
        "Check how many doses are left. Get a new one before it runs out.",
        "Avoid smoke from cigarettes, bidis, chulhas and burning rubbish, and dust where you can.",
      ]),
      COME_BACK,
      list([
        "Your breathing gets worse and your reliever inhaler does not help, or you need it much more often than usual.",
        "You cannot speak in full sentences because of breathlessness.",
        "Your lips or fingernails look blue or grey.",
        "You feel drowsy or confused.",
      ]),
    ]),
    leaflet("after-heart-attack", "After a heart attack", ["heart attack", "myocardial infarction", "cardiology", "discharge"], [
      "A heart attack happens when blood cannot reach part of the heart muscle. With the right care, most people go back to a normal life. This leaflet tells you how to protect your heart.",
      "Medicines",
      list([
        "Your heart medicines are very important. Take them every day exactly as written on your prescription.",
        "Do not stop any of them, even if you feel well, unless your heart doctor tells you to.",
        "If you had a stent, stopping some blood thinners early can be dangerous.",
        "Keep any medicine your doctor gave you for chest pain with you at all times, and know how to use it.",
      ]),
      "Daily life",
      list([
        "Stop smoking, bidis and chewing tobacco completely. Ask the hospital for help to quit.",
        "Walk a little every day and slowly walk more, as your doctor advises.",
        "Ask your doctor when you can go back to work, drive, travel and have sex.",
        "Eat less salt, pickles, papad and namkeen. Eat less ghee, butter, vanaspati and fried food.",
        "Eat more vegetables, fruits, dal and whole grains.",
        "Keep your weight, blood pressure, sugar and cholesterol in control. Go for all your check-ups.",
      ]),
      COME_BACK,
      list([
        "You have chest pain, pressure or tightness that lasts more than a few minutes or keeps coming back.",
        "Pain spreads to your arm, jaw, neck or back.",
        "You are suddenly very breathless, sweating, or feel faint.",
        "Your heartbeat feels very fast or uneven.",
        "Your legs or feet swell a lot, or you gain weight fast.",
      ]),
      "If chest pain comes, stop what you are doing and sit down. Call 108. Do not drive yourself to hospital.",
    ]),
    leaflet("after-stroke", "After a stroke", ["stroke", "neurology", "discharge"], [
      "A stroke happens when blood supply to part of the brain stops or a blood vessel bursts. Recovery can continue for many months. This leaflet helps you and your family at home.",
      "Medicines and check-ups",
      list([
        "Take your medicines every day exactly as written on your prescription. They help prevent another stroke.",
        "Keep your blood pressure, sugar and cholesterol in control. Go for all your check-ups.",
        "Stop smoking, bidis, chewing tobacco and alcohol.",
      ]),
      "Recovery at home",
      list([
        "Do the exercises the physiotherapist taught you every day.",
        "Help the person do as much as they can for themselves, slowly.",
        "Make the home safe: clear the floor, use good light, and put a grab rail or chair in the bathroom if possible.",
        "If swallowing is difficult, give food and drinks only as the hospital team advised. Sit the person upright to eat.",
        "If the person cannot move in bed, turn them every few hours and keep the skin clean and dry to prevent bed sores.",
        "Mood can be low after a stroke. Talk to the doctor if this happens.",
      ]),
      "Know the signs of a new stroke (BE FAST)",
      list([
        "Balance: sudden loss of balance.",
        "Eyes: sudden loss of vision.",
        "Face: one side of the face droops.",
        "Arm: one arm or leg is weak or numb.",
        "Speech: speech is slurred or confused.",
        "Time: call 108 at once. Every minute counts.",
      ]),
      COME_BACK,
      list([
        "Any BE FAST sign appears, even if it goes away.",
        "The person coughs or chokes on food or drink, or has fever with a cough.",
        "The person becomes very sleepy, confused or has a fit.",
        "A leg becomes swollen, red or painful.",
        "A bed sore appears or gets worse.",
      ]),
    ]),
    leaflet("fever-when-to-return", "Fever: care at home and when to come back", ["fever", "infection", "discharge"], [
      "Fever means a body temperature of 100.4 F (38 C) or more. It is often caused by an infection. This leaflet tells you how to care for fever at home and when to come back.",
      "At home",
      list([
        "Rest.",
        "Drink plenty of fluids: water, ORS, nimbu pani, coconut water, buttermilk, dal water or soup.",
        "Wear light clothes. Sponge the body with normal tap water if the person feels very hot.",
        "Take only the fever medicine your doctor prescribed, at the times written. Do not take extra painkillers or injections from a shop.",
        "Check the temperature with a thermometer and write it down with the time.",
        "Use mosquito nets and repellents. Do not let water collect in coolers, pots or tyres.",
        "Wash your hands often, and cover your mouth when you cough or sneeze.",
      ]),
      COME_BACK,
      list([
        "The fever lasts more than 3 days, or comes back after going away.",
        "There is breathlessness, fast breathing or chest pain.",
        "There is severe tummy pain or repeated vomiting.",
        "There is bleeding from the gums or nose, black stools, or red spots on the skin.",
        "The person passes very little urine, or feels faint or very weak.",
        "There is a stiff neck, severe headache, confusion, drowsiness or a fit.",
        "A baby under 3 months has any fever, or a child is not drinking or is very sleepy.",
        "The person is pregnant, elderly, or has diabetes, kidney, heart or lung disease and is getting worse.",
      ]),
    ]),
    leaflet("newborn-care-discharge", "Caring for your newborn baby at home", ["newborn", "baby", "paediatrics", "maternity", "discharge"], [
      "Congratulations on your baby. This leaflet tells you how to care for your baby at home and which danger signs need the hospital at once.",
      "Feeding",
      list([
        "Give only breast milk for the first 6 months. No water, honey, ghutti, sugar water or animal milk.",
        "Feed whenever the baby wants, day and night, at least 8 times in 24 hours.",
        "A well-fed baby passes urine many times a day and gains weight.",
        "Burp the baby after each feed.",
      ]),
      "Warmth and sleep",
      list([
        "Keep the baby warm. Cover the head, hands and feet. Hold the baby skin to skin on the mother's chest (kangaroo care), especially a small baby.",
        "Do not bathe a small or unwell baby. Ask your nurse when to start baths.",
        "Put the baby to sleep on the back, on a firm surface, near the mother.",
      ]),
      "Cord care",
      "Keep the cord stump clean and dry. Do not put oil, ghee, ash, turmeric or any powder on it. It will fall off on its own.",
      "Keep the baby safe from infection",
      list([
        "Wash your hands with soap before you touch the baby.",
        "Keep the baby away from people with cough, cold or fever.",
        "Do not apply kajal or put oil in the ears or nose.",
        "Follow the vaccination card. Take the baby for every vaccine on time.",
      ]),
      COME_BACK,
      list([
        "The baby is not feeding well or stops feeding.",
        "The baby has a fit (convulsion).",
        "The baby breathes fast, or the chest pulls in with each breath.",
        "The baby feels hot, or feels cold to touch.",
        "The baby is very sleepy, floppy or does not move much.",
        "The skin, eyes, palms or soles look yellow.",
        "The cord is red, swollen, smells bad or has pus.",
        "The baby vomits again and again, has a swollen tummy, or has blood in the stool.",
      ]),
    ]),
    leaflet("plaster-cast-care", "Caring for your plaster cast", ["plaster", "cast", "fracture", "orthopaedics", "discharge"], [
      "A plaster cast holds a broken bone still so it can heal. This leaflet tells you how to look after it.",
      "For the first two days",
      list([
        "Keep the arm or leg raised on pillows, above the level of your heart, as much as you can. This reduces swelling.",
        "Move your fingers or toes often.",
        "A new plaster cast takes time to become fully hard. Do not press it, rest it on a hard edge, or walk on a leg plaster until you are told you can.",
      ]),
      "Every day",
      list([
        "Keep the cast dry. Cover it with a plastic bag when you bathe and keep it out of the water.",
        "Do not push anything inside the cast to scratch. You can damage the skin and cause infection.",
        "Do not cut, trim or remove the cast yourself.",
        "Do not put powder or oil inside the cast.",
        "Use crutches, a sling or a walker as you were shown.",
        "Take your medicines as written on your prescription.",
      ]),
      "Your discharge papers say when to come back for a check and an X-ray. Keep that appointment.",
      COME_BACK,
      list([
        "Pain gets worse and is not helped by raising the limb and taking your prescribed medicine.",
        "Fingers or toes become numb, tingle, turn blue, pale or very swollen, or you cannot move them.",
        "The cast feels too tight, too loose, is cracked or broken, or has become soft or wet.",
        "There is a bad smell or fluid coming from under the cast.",
        "You have fever.",
        "You have calf pain or swelling, chest pain or sudden breathlessness.",
      ]),
    ]),
  ]),
});
