/* StewardMD full-screen loader (smd-loader.js). ES5.
 * A 3D ring of beating hearts over a scrolling ECG, plus a rotating lesser-known medical fact, for screens that would otherwise be empty while
 * they load. skeletons.js uses it for "Loading..." placeholders that are alone on a screen; the module loaders
 * (kardia, prep, narke, tokos) use during() while their scripts download.
 * The ring is pure CSS transform and opacity, so it keeps turning while the main thread is parsing scripts.
 * Kill switch: localStorage smd_loader=0 (every caller then falls back to what it did before). */
(function () {
  "use strict";
  var FACTS = [
    "Ciguatera poisoning can reverse temperature sense: cold objects feel burning hot.",
    "Neuromyelitis optica can present as weeks of intractable hiccups from an area postrema lesion.",
    "Arnold's reflex: touching the ear canal can trigger a cough through the auricular branch of the vagus.",
    "In superior canal dehiscence, loud sounds can cause vertigo. This is the Tullio phenomenon.",
    "Anton syndrome: patients with cortical blindness deny being blind and confabulate what they see.",
    "Some hemiplegic patients move the paralysed arm only when they yawn: parakinesia brachialis oscitans.",
    "Gelastic seizures, bouts of mirthless laughter, classically point to a hypothalamic hamartoma.",
    "Witzelsucht is compulsive, inappropriate joking after orbitofrontal damage.",
    "Dream enactment in REM sleep behaviour disorder can precede Parkinson disease by a decade or more.",
    "Capgras delusion: the belief that someone close has been replaced by an identical impostor.",
    "Cotard delusion: a patient may insist they are dead or that their organs have rotted.",
    "Alice in Wonderland syndrome, distorted size and perception, is linked to migraine and Epstein-Barr virus.",
    "Foreign accent syndrome can appear after a stroke, with no exposure to that accent.",
    "Frey syndrome: after parotid surgery, severed nerves regrow into sweat glands, so eating causes facial sweating.",
    "Crocodile tears: after facial palsy, salivary fibres can regrow to the lacrimal gland, so eating brings tears.",
    "Marcus Gunn jaw winking: a ptotic eyelid lifts when the jaw moves.",
    "Hutchinson sign: zoster on the tip of the nose warns of eye involvement through the nasociliary nerve.",
    "Long QT triggers differ by gene: swimming in LQT1, a sudden alarm in LQT2, rest or sleep in LQT3.",
    "Commotio cordis: a chest blow during the upstroke of the T wave can cause VF in a structurally normal heart.",
    "Fever can unmask a Brugada pattern and trigger dangerous arrhythmia.",
    "Takotsubo is named after a Japanese octopus trap, the shape of the ballooned left ventricle.",
    "Pulse oximetry drifts towards 85% in significant methaemoglobinaemia, whatever the true saturation.",
    "Standard pulse oximeters read carboxyhaemoglobin as oxyhaemoglobin, so CO poisoning can show a normal SpO2.",
    "Biotin supplements can distort streptavidin immunoassays and mimic thyroid disease on paper.",
    "EDTA can clump platelets in the tube, creating a thrombocytopenia that does not exist.",
    "The hook effect: an extremely high hormone level can read falsely low, as with giant prolactinomas.",
    "Very high white counts can consume glucose in the tube and fake hypoglycaemia.",
    "Purple urine bag syndrome: tryptophan metabolites become indigo and indirubin in an infected alkaline catheter.",
    "Propofol can turn urine green through its phenolic metabolites.",
    "Carotenaemia yellows the skin but spares the sclera, unlike jaundice.",
    "Silver exposure can leave permanent slate-grey skin, a condition called argyria.",
    "Blue diaper syndrome: a tryptophan transport defect produces urine that stains nappies blue.",
    "Auto-brewery syndrome: gut fungi ferment carbohydrates into enough ethanol to intoxicate.",
    "Mad honey from rhododendron nectar contains grayanotoxin and can cause bradycardia and hypotension.",
    "Scombroid mimics an allergy: bacteria convert histidine in spoiling fish into histamine.",
    "Neurolathyrism, a spastic paraparesis, comes from the ODAP toxin in grass pea, known in India as khesari dal.",
    "Encephalopathy outbreaks in Muzaffarpur were tied to litchi toxins in undernourished children who skipped dinner.",
    "Polar bear liver holds enough vitamin A to cause severe hypervitaminosis in those who eat it.",
    "Kuru spread through funerary cannibalism among the Fore people of Papua New Guinea.",
    "Fatal familial insomnia is a prion disease that targets the thalamus and abolishes sleep.",
    "Mycobacterium leprae still cannot be grown in standard culture. It is propagated in armadillos and mouse footpads.",
    "Tropheryma whipplei, the cause of Whipple disease, was first cultured in 2000, nearly a century after its description.",
    "People who lack the Duffy antigen on red cells are largely resistant to Plasmodium vivax.",
    "Loa loa, the African eye worm, can be seen crawling across the conjunctiva.",
    "Naegleria fowleri reaches the brain through the cribriform plate after water enters the nose.",
    "The Bombay blood group, which lacks H antigen, was first described in Mumbai in 1952.",
    "Rh-null blood lacks all Rh antigens. Only a few dozen people are known to have had it.",
    "A tetragametic chimera can carry two DNA profiles and fail a maternity test for their own child.",
    "Fetal cells can persist in a mother's body for decades after pregnancy: fetal microchimerism.",
    "A female fetus holds its peak number of oocytes, about 6 to 7 million, at around 20 weeks of gestation.",
    "In fibrodysplasia ossificans progressiva, even a biopsy can trigger new bone in soft tissue.",
    "Loss of Nav1.7 (SCN9A) causes a lifelong inability to feel pain. Gain of function causes burning erythromelalgia.",
    "PHOX2B mutations cause congenital central hypoventilation: breathing fails when the child sleeps.",
    "The Lazarus sign: a brain-dead patient may raise the arms through a spinal reflex.",
    "Anna B\u00e5genholm survived a core temperature of 13.7 °C after being trapped under ice in 1999.",
    "Exenatide is derived from a peptide in Gila monster venom.",
    "Captopril was designed from a peptide in the venom of the Brazilian pit viper Bothrops jararaca.",
    "Eptifibatide was modelled on a protein from the venom of the southeastern pygmy rattlesnake.",
    "Sirolimus came from a soil bacterium on Easter Island, known locally as Rapa Nui.",
    "Cisplatin was found when platinum electrodes unexpectedly stopped E. coli from dividing.",
    "Warfarin takes its name from the Wisconsin Alumni Research Foundation and began as a rat poison.",
    "Metformin traces back to galegine from French lilac, a herbal remedy in medieval Europe.",
    "Penicillin was so scarce in the early 1940s that it was recovered from patients' urine and reused.",
    "The discoverers of insulin sold the patent to the University of Toronto for one dollar each.",
    "Werner Forssmann passed a catheter into his own heart in 1929, then walked to X-ray to prove it.",
    "Barry Marshall drank a culture of Helicobacter pylori in 1984 to show it causes gastritis.",
    "Dilip Mahalanabis used oral rehydration in 1971 refugee camps and cut cholera deaths from about 30% to under 4%.",
    "Ronald Ross proved mosquito transmission of malaria while working in Secunderabad in 1897.",
    "Sushruta's forehead flap for nasal reconstruction reached Europe through a 1794 report from India.",
    "Yellapragada Subbarow's team developed methotrexate and the first synthesis of folic acid.",
    "John Snow, of the Broad Street pump, also gave chloroform to Queen Victoria in childbirth.",
    "Tu Youyou found the key to extracting artemisinin in a 4th century Chinese text on fevers.",
    "Armand Trousseau, who described migratory thrombophlebitis in cancer, recognised the sign in himself.",
    "The Sister Mary Joseph nodule is named after a surgical assistant to William Mayo who noticed it.",
    "James Lind's 1747 scurvy trial on HMS Salisbury is among the earliest controlled trials.",
    "Intravenous lipid rescue for local anaesthetic toxicity began with experiments in rats.",
    "The body makes roughly 2 million red cells every second.",
    "The cornea has no blood vessels and takes most of its oxygen from the air.",
    "The stapes, about 3 mm long, is the smallest named bone in the body.",
    "Cerebrospinal fluid is replaced about three to four times a day.",
    "Photic sneezing, the ACHOO syndrome, affects up to a third of people and is autosomal dominant.",
    "Exploding head syndrome: an imagined loud bang at sleep onset, harmless and classified as a parasomnia.",
    "Uhthoff phenomenon: a hot bath can temporarily worsen vision in multiple sclerosis.",
    "The last natural case of smallpox was Ali Maow Maalin, in Somalia in 1977. He later worked on polio eradication.",
    "Guinea worm has no drug or vaccine, yet it is close to eradication through safe water and behaviour change.",
    "Thalidomide, once withdrawn for birth defects, is now a treatment for myeloma and leprosy reactions.",
    "The idea of lithium for mania came from John Cade's 1949 experiments on guinea pigs."
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = { FACTS: FACTS };
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_loader") === "0") return; } catch (e) {}

  /* The ring turns once in three beats. The ECG moves one complex per beat, and its R wave is under the front heart at 43%. */
  var COUNT = 12, BEAT = 1.2, TURN = BEAT * 3, RADIUS = 62, RED = "#e8405a";
  var HEART = "M12 21C5 15.5 2 12 2 8a5 5 0 0 1 10-1.5A5 5 0 0 1 22 8c0 4-3 7.5-10 13z";
  function mask(svg) { var u = "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\")"; return "-webkit-mask:" + u + " center/100% 100% no-repeat;mask:" + u + " center/100% 100% no-repeat;"; }
  var SHARP = mask("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='" + HEART + "'/></svg>");
  var SOFT = mask("<svg xmlns='http://www.w3.org/2000/svg' viewBox='-5 -5 34 34'><filter id='b'><feGaussianBlur stdDeviation='1.5'/></filter><path filter='url(#b)' d='" + HEART + "'/></svg>");
  var css =
    ".smd-ld{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;box-sizing:border-box;width:100%;min-height:min(62vh,460px);padding:24px;text-align:center;animation:smdLdIn .24s .12s both}" +
    ".smd-ld-vis{display:flex;flex-direction:column;align-items:center;gap:8px}" +
    ".smd-ld-stage{width:190px;height:84px;perspective:360px;display:flex;align-items:center;justify-content:center}" +
    ".smd-ld-beat{width:30px;height:30px;transform-style:preserve-3d;animation:smdLdBeat " + BEAT + "s linear infinite}" +
    ".smd-ld-ecg{width:220px;height:40px;overflow:hidden;color:" + RED + ";-webkit-mask-image:linear-gradient(90deg,transparent,#000 24%,#000 76%,transparent);mask-image:linear-gradient(90deg,transparent,#000 24%,#000 76%,transparent)}" +
    ".smd-ld-ecg svg{display:block;animation:smdLdEcg " + BEAT + "s linear infinite}" +
    ".smd-ld-ring{position:relative;width:30px;height:30px;transform-style:preserve-3d;transform:rotateX(-14deg) rotateY(0);animation:smdLdSpin " + TURN + "s linear infinite}" +
    ".smd-ld-disc{position:absolute;inset:0;transform-style:preserve-3d}" +
    ".smd-ld-disc i{position:absolute;inset:0;animation:" + TURN + "s linear var(--d) infinite both}" +
    ".smd-ld-disc .a{background:linear-gradient(165deg,#ff7087," + RED + " 55%,#c81e43);" + SHARP + "animation-name:smdLdA}" +
    ".smd-ld-disc .b{inset:-6px;background:" + RED + ";" + SOFT + "animation-name:smdLdB}" +
    ".smd-ld-fact{margin:0;max-width:21em;font-size:19px;line-height:1.36;font-weight:500;letter-spacing:-.012em;opacity:.86;transition:opacity .26s ease;text-wrap:balance}" +
    ".smd-ld-fact.out{opacity:0}" +
    ".smd-ld-fact span{display:inline-block;animation:smdLdWord .42s cubic-bezier(.23,1,.32,1) both;animation-delay:calc(var(--i)*24ms)}" +
    ".smd-ld-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}" +
    ".smd-ld-cover{position:fixed;inset:0;z-index:790;display:flex;align-items:center;justify-content:center;transition:opacity .2s ease}" +
    ".smd-ld-cover.out{opacity:0;pointer-events:none}" +
    ".smd-ld-back{position:absolute;left:12px;top:calc(env(safe-area-inset-top,0px) + 8px);width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:inherit;font:inherit;display:flex;align-items:center;justify-content:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent}" +
    ".smd-ld-back:active{opacity:.5}" +
    "@keyframes smdLdIn{from{opacity:0}to{opacity:1}}" +
    "@keyframes smdLdSpin{to{transform:rotateX(-14deg) rotateY(360deg)}}" +
    /* Keyframe position is the disc's place on the ring: 0% front, 25% side, 50% back. */
    "@keyframes smdLdA{0%,100%{opacity:1}9%,91%{opacity:.8}25%,75%{opacity:.44}38%,62%{opacity:.08}50%{opacity:0}}" +
    "@keyframes smdLdB{0%,12%,88%,100%{opacity:0}25%,75%{opacity:.16}50%{opacity:.34}}" +
    "@keyframes smdLdBeat{0%,33%,100%{transform:scale(1)}43%{transform:scale(1.1)}52%{transform:scale(1)}60%{transform:scale(1.05)}72%{transform:scale(1)}}" +
    "@keyframes smdLdEcg{to{transform:translateX(-110px)}}" +
    "@keyframes smdLdWord{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}" +
    /* Paused keeps each disc at its own place on the ring, so the still image is still a ring. */
    "@media (prefers-reduced-motion:reduce){.smd-ld-ring,.smd-ld-beat,.smd-ld-ecg svg,.smd-ld-disc i{animation-play-state:paused}.smd-ld-fact span{animation:none}}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var RING = "";
  for (var n = 0; n < COUNT; n++) {
    RING += '<div class="smd-ld-disc" style="transform:rotateY(' + (n * 360 / COUNT) + "deg) translateZ(" + RADIUS + "px);--d:" + (-n * TURN / COUNT).toFixed(2) + 's"><i class="a"></i><i class="b"></i></div>';
  }

  var ECG = "M0 24";
  for (var c = 0; c < 4; c++) ECG += "h18q6-6 12 0h10l3 3 4-22 4 26 3-7h10q10-10 20 0h26";

  var deck = [], fact = "", timer = 0;
  function next() {
    if (!deck.length) {
      deck = FACTS.slice();
      for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    }
    return (fact = deck.pop());
  }
  function words(f) {
    return f.split(" ").map(function (w, i) { return '<span style="--i:' + i + '">' + w + "</span>"; }).join(" ");
  }
  function arm() { if (!timer) timer = setTimeout(tick, Math.max(4600, fact.length * 62)); }
  function each(fn) { var a = document.querySelectorAll(".smd-ld-fact"); for (var i = 0; i < a.length; i++) fn(a[i]); return a.length; }
  function tick() {
    timer = 0;
    if (!each(function (el) { el.classList.add("out"); })) return;
    setTimeout(function () {
      var f = next();
      if (each(function (el) { el.innerHTML = words(f); el.classList.remove("out"); })) arm();
    }, 280);
  }
  function html() {
    if (!timer) next();
    arm();
    return '<div class="smd-ld" data-no-skel><div class="smd-ld-vis" aria-hidden="true"><div class="smd-ld-stage"><div class="smd-ld-beat"><div class="smd-ld-ring">' + RING + '</div></div></div><div class="smd-ld-ecg"><svg width="440" height="40" viewBox="0 0 440 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="' + ECG + '"/></svg></div></div><p class="smd-ld-fact">' + words(fact) + "</p></div>";
  }
  function pageColours() {
    var b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
    var clear = /^(transparent|rgba\(.*, 0\))$/;
    return { bg: !clear.test(b.backgroundColor) ? b.backgroundColor : !clear.test(h.backgroundColor) ? h.backgroundColor : "#101418", fg: b.color };
  }
  /* Covers the screen while promise p is pending. The result passes straight through, so the caller opens the module
     first and the cover fades off the top of it. If the person taps back, the result never arrives and nothing opens. */
  function during(p) {
    var c = pageColours(), cancelled = false, el = document.createElement("div");
    el.className = "smd-ld-cover";
    el.style.background = c.bg; el.style.color = c.fg;
    el.innerHTML = '<button type="button" class="smd-ld-back" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button><span class="smd-ld-sr" role="status">Loading</span>' + html();
    document.body.appendChild(el);
    function hide() { el.classList.add("out"); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220); }
    el.firstChild.addEventListener("click", function () { cancelled = true; hide(); });
    return p.then(function (v) {
      if (cancelled) return new Promise(function () {});
      setTimeout(hide, 0);
      return v;
    }, function (e) { hide(); throw e; });
  }
  window.SMD_LOADER = { html: html, during: during };
})();
