/**
 * Businesses most New Zealanders' bank lines are with, and what each sells.
 *
 * Two uses, both before anything is sent to a model:
 *
 * - Where what a business sells settles the account on its own -- fuel,
 *   power, a phone plan, a council's rates -- the line is suggested an account
 *   straight from the chart, and no model is asked about it at all.
 * - Where it does not -- a supermarket can be stock, staff tea or groceries --
 *   the line still goes to the model, but with one short note on it saying
 *   what the business is. Only the notes for the lines being asked about are
 *   sent, never this list.
 *
 * Large national and well-known overseas businesses only, and government.
 * Never a local business: a list of somebody's suppliers is private, and this
 * file is public.
 *
 * Each entry is "Name|ALIASES|kind". Aliases are how banks write the name,
 * comma separated; the name itself is always one. Matching ignores case,
 * spaces and punctuation ("PAK N SAVE", "PAKNSAVE" and "Pak'nSave" are one).
 * A one-word alias ("Z", "SPARK", "FARMERS") counts only as the first word of
 * a field, after the bank's own "POS" or "EFTPOS" and any card number, which
 * is where a bank puts the payee: so "Z" is never found inside a name, and a
 * person called Farmer Spark is not a power company.
 */

export interface BusinessKind {
  /** What a business of this kind sells, in a few words, for a person or a model. */
  what: string;
  /**
   * Chart account names that fit money spent with it, tried in order: the
   * first that finds exactly one account wins. None where the account depends
   * on the business buying -- a supermarket, a bank -- and then nothing is
   * suggested, only described.
   */
  accounts?: readonly RegExp[];
  /**
   * Where the money was paid in another currency: the same thing bought
   * overseas, so international travel rather than domestic.
   */
  abroad?: readonly RegExp[];
}

const TRAVEL_AWAY = [/travel.*(international|overseas)|(international|overseas).*travel/i];
// "\bnational" because "International" contains "national".
const TRAVEL_HERE = [
  /travel.*\b(national|domestic)\b|\b(national|domestic)\b.*travel/i,
  /^travel\b(?!.*(international|overseas))/i,
];

export const BUSINESS_KINDS = {
  fuel: { what: "fuel station", accounts: [/motor ?vehicle/i, /\bvehicle/i, /\bfuel/i] },
  vehicle: { what: "car parts, tyres and servicing", accounts: [/motor ?vehicle/i, /\bvehicle/i] },
  vehicleLicence: { what: "vehicle registration, WoF and road user charges", accounts: [/motor ?vehicle/i, /\bvehicle/i] },
  parking: { what: "parking", accounts: [/parking/i, /motor ?vehicle/i] },
  tolls: { what: "road tolls and transport", accounts: [/motor ?vehicle/i, ...TRAVEL_HERE] },
  transport: { what: "public transport, ferries and taxis", accounts: TRAVEL_HERE, abroad: TRAVEL_AWAY },
  rentalCar: { what: "rental cars", accounts: TRAVEL_HERE, abroad: TRAVEL_AWAY },
  airline: { what: "airline flying both within New Zealand and overseas: which travel account depends on the flight" },
  domesticAirline: { what: "domestic airline", accounts: TRAVEL_HERE },
  overseasAirline: {
    what: "international airline",
    accounts: [/travel.*(international|overseas)|(international|overseas).*travel/i],
  },
  accommodation: { what: "accommodation", accounts: [/accommodation/i, ...TRAVEL_HERE], abroad: TRAVEL_AWAY },
  bookingSite: { what: "travel booking site, for stays in New Zealand or overseas", abroad: TRAVEL_AWAY },
  telco: { what: "phone and internet provider", accounts: [/telephone|phone|internet|telco|communication/i] },
  power: { what: "power and gas retailer", accounts: [/light.*power|power|electricity|energy|heating/i] },
  water: { what: "water supply", accounts: [/water/i, /\brates\b/i] },
  council: {
    what: "local council: mostly rates, also consents, dog registration and other fees",
    accounts: [/\brates\b/i],
  },
  regionalCouncil: { what: "regional council: rates and resource consents", accounts: [/\brates\b/i] },
  insurance: { what: "insurer: house, contents, vehicle or business insurance", accounts: [/insurance/i] },
  healthInsurance: { what: "health or life insurer: usually a personal cost" },
  bank: { what: "bank: fees, interest, loan payments or transfers, so read the details" },
  tax: {
    what: "Inland Revenue: a GST, income tax, PAYE or provisional tax payment or refund, so not an expense",
  },
  acc: { what: "ACC levies", accounts: [/\bacc\b|levies/i] },
  government: { what: "government fees and charges" },
  bond: { what: "tenancy bonds, lodged or refunded: held for the tenant, so not income or an expense" },
  fines: { what: "fines, which are not deductible" },
  supermarket: { what: "supermarket" },
  convenience: { what: "convenience store" },
  fastFood: { what: "fast food and cafes" },
  foodDelivery: { what: "food delivery" },
  liquor: { what: "liquor store" },
  pharmacy: { what: "pharmacy" },
  hardware: { what: "hardware and building supplies: repairs, materials or tools" },
  office: { what: "office supplies and printing", accounts: [/printing|stationery|office (supplies|expenses)/i] },
  courier: { what: "courier, freight and post", accounts: [/freight|courier|postage/i] },
  software: { what: "software subscription", accounts: [/subscriptions?|software|computer expenses|\bit (costs|expenses)/i] },
  hosting: { what: "web hosting and domain names", accounts: [/website|hosting|domain/i, /subscriptions?|software/i] },
  advertising: { what: "advertising", accounts: [/advertising|marketing/i] },
  recruitment: { what: "job advertising", accounts: [/recruit/i, /advertising/i] },
  electronics: { what: "electronics and computers: an asset when it costs more than $1,000" },
  retail: { what: "general retailer" },
  outdoor: { what: "outdoor, sport and recreation retailer" },
  homeware: { what: "furniture, homeware and fabric retailer" },
  marketplace: { what: "online marketplace: anything at all, so read the details" },
  payments: { what: "payment service: money in is usually customers paying, money out a purchase or fees" },
  transfer: { what: "money transfer service: often a transfer between your own accounts, or an overseas payment" },
  crypto: { what: "cryptocurrency exchange: usually an investment, not an expense" },
  streaming: { what: "streaming and media subscription: usually personal" },
  apple: { what: "App Store, iCloud and Apple Music subscriptions, or Apple devices" },
  gym: { what: "gym membership: usually personal" },
  entertainment: { what: "cinema and entertainment" },
  charity: { what: "charity: a donation, or a purchase from its shop" },
  payroll: { what: "payroll service: its fees, or wages paid through it" },
  accounting: { what: "accounting and business software", accounts: [/subscriptions?|software|computer expenses/i] },
  evCharging: { what: "electric vehicle charging", accounts: [/motor ?vehicle/i, /\bvehicle/i] },
  professional: {
    what: "professional body or registration: membership and practising fees",
    accounts: [/dues|memberships?|registrations?|practising/i, /subscriptions?/i],
  },
  education: { what: "education provider: course fees", accounts: [/training|education|professional development|courses?/i] },
  news: { what: "news subscription", accounts: [/subscriptions?/i] },
  childcare: { what: "childcare: usually personal" },
  attraction: { what: "attraction, ski field or day out: usually personal or entertainment" },
  farm: { what: "farm supplies and services: fertiliser, seed, animal health or stock" },
} as const satisfies Record<string, BusinessKind>;

export type BusinessKindName = keyof typeof BUSINESS_KINDS;

const LIST = `
Z Energy|Z ENERGY,Z,Z STATION|fuel
BP|BP,BP CONNECT,BP 2GO|fuel
Mobil|MOBIL|fuel
Caltex|CALTEX|fuel
Gull|GULL|fuel
Waitomo Fuel|WAITOMO,WAITOMO APP,WAITOMO FUEL|fuel
NPD|NPD,NPD FUEL|fuel
Challenge|CHALLENGE FUEL,CHALLENGE|fuel
Allied Petroleum|ALLIED PETROLEUM,ALLIED FUEL|fuel
Pak'nSave Fuel|PAKNSAVE FUEL,PAK N SAVE FUEL|fuel
Costco Fuel|COSTCO FUEL,COSTCO GASOLINE|fuel
Tasman Fuels|TASMAN FUELS|fuel
Rural Fuel|RURAL FUEL|fuel
Supercheap Auto|SUPERCHEAP AUTO,SUPERCHEAP|vehicle
Repco|REPCO|vehicle
BNT|BNT AUTOMOTIVE,BNT|vehicle
Beaurepaires|BEAUREPAIRES|vehicle
Bridgestone|BRIDGESTONE,BRIDGESTONE SELECT|vehicle
Tony's Tyre Service|TONYS TYRE,TONYS TYRES|vehicle
Tyreline|TYRELINE|vehicle
Pit Stop|PIT STOP,PITSTOP|vehicle
Midas|MIDAS|vehicle
Firestone|FIRESTONE|vehicle
Goodyear|GOODYEAR|vehicle
Battery Town|BATTERY TOWN|vehicle
Century Batteries|CENTURY BATTERIES|vehicle
Smart Windscreens|SMART WINDSCREENS|vehicle
Novus|NOVUS AUTOGLASS,NOVUS|vehicle
Autosure|AUTOSURE|insurance
VTNZ|VTNZ,VEHICLE TESTING NZ|vehicleLicence
VINZ|VINZ|vehicleLicence
AA|AA,NZ AUTOMOBILE ASSOCIATION,AA CENTRE,AA ROADSERVICE|vehicleLicence
Waka Kotahi NZ Transport Agency|NZTA,NZ TRANSPORT AGENCY,WAKA KOTAHI,NZTA REGO,NZTA RUC|vehicleLicence
Wilson Parking|WILSON PARKING,WILSONS PARKING|parking
Care Park|CARE PARK,CAREPARK|parking
Secure Parking|SECURE PARKING|parking
Auckland Transport Parking|AT PARKING,AT PARK|parking
PayMyPark|PAYMYPARK|parking
Parkmate|PARKMATE|parking
Frogparking|FROGPARKING|parking
Auckland Transport|AUCKLAND TRANSPORT,AT HOP,AT METRO|transport
Metlink|METLINK|transport
Snapper|SNAPPER|transport
Bee Card|BEE CARD,BEECARD|transport
Metro Christchurch|METRO CHRISTCHURCH,METROCARD|transport
Interislander|INTERISLANDER,KIWIRAIL|transport
Bluebridge|BLUEBRIDGE,STRAIT SHIPPING|transport
Fullers360|FULLERS,FULLERS360|transport
InterCity|INTERCITY|transport
Uber|UBER,UBER TRIP,UBER BV|transport
Ola|OLA CABS,OLA|transport
DiDi|DIDI|transport
Zoomy|ZOOMY|transport
Blue Bubble Taxi|BLUE BUBBLE|transport
Green Cabs|GREEN CABS|transport
Corporate Cabs|CORPORATE CABS|transport
Co-op Taxis|COOP TAXIS,CO OP TAXIS|transport
Lime|LIME SCOOTER,LIME|transport
Beam|BEAM MOBILITY|transport
Avis|AVIS|rentalCar
Hertz|HERTZ|rentalCar
Budget Rent a Car|BUDGET RENT,BUDGET CAR|rentalCar
Europcar|EUROPCAR|rentalCar
Thrifty|THRIFTY|rentalCar
Enterprise Rent-A-Car|ENTERPRISE RENT|rentalCar
Apex Car Rentals|APEX CAR,APEX RENTALS|rentalCar
GO Rentals|GO RENTALS|rentalCar
Jucy|JUCY|rentalCar
Ezi Car Rental|EZI CAR|rentalCar
Snap Rentals|SNAP RENTALS|rentalCar
Omega Rental Cars|OMEGA RENTAL|rentalCar
Mevo|MEVO|rentalCar
Cityhop|CITYHOP|rentalCar
Air New Zealand|AIR NEW ZEALAND,AIR NZ,AIRNZ|airline
Jetstar|JETSTAR|airline
Qantas|QANTAS|airline
Virgin Australia|VIRGIN AUSTRALIA,VIRGIN AUST|airline
Sounds Air|SOUNDS AIR|domesticAirline
Air Chathams|AIR CHATHAMS|domesticAirline
Originair|ORIGINAIR|domesticAirline
Barrier Air|BARRIER AIR|domesticAirline
Singapore Airlines|SINGAPORE AIRLINES,SINGAPORE AIR|overseasAirline
Emirates|EMIRATES|overseasAirline
Cathay Pacific|CATHAY PACIFIC|overseasAirline
Korean Air|KOREAN AIR|overseasAirline
LATAM|LATAM|overseasAirline
United Airlines|UNITED AIRLINES|overseasAirline
Fiji Airways|FIJI AIRWAYS|overseasAirline
China Southern|CHINA SOUTHERN|overseasAirline
Booking.com|BOOKING COM,BOOKINGCOM,BOOKING|bookingSite
Airbnb|AIRBNB|bookingSite
Expedia|EXPEDIA|bookingSite
Hotels.com|HOTELS COM,HOTELSCOM|bookingSite
Agoda|AGODA|bookingSite
Trivago|TRIVAGO|bookingSite
Bookabach|BOOKABACH|accommodation
Holiday Houses|HOLIDAY HOUSES|accommodation
Accor|ACCOR,NOVOTEL,IBIS,MERCURE,SOFITEL,PULLMAN|accommodation
Quest Apartments|QUEST|accommodation
Heritage Hotels|HERITAGE HOTEL,HERITAGE HOTELS|accommodation
Distinction Hotels|DISTINCTION|accommodation
Scenic Hotels|SCENIC HOTEL,SCENIC HOTELS|accommodation
Millennium Hotels|MILLENNIUM HOTEL,COPTHORNE,KINGSGATE|accommodation
Hilton|HILTON HOTEL,HILTON HOTELS|accommodation
Rydges|RYDGES|accommodation
Sudima|SUDIMA|accommodation
Jucy Snooze|JUCY SNOOZE|accommodation
YHA|YHA|accommodation
Top 10 Holiday Parks|TOP 10,TOP10|accommodation
Kiwi Holiday Parks|KIWI HOLIDAY PARKS|accommodation
DOC Bookings|DOC BOOKING,DEPARTMENT OF CONSERVATION,DOC|accommodation
Spark|SPARK,SPARK NZ,TELECOM|telco
One NZ|ONE NZ,ONENZ,VODAFONE|telco
2degrees|2DEGREES,2 DEGREES,TWO DEGREES|telco
Skinny|SKINNY|telco
Slingshot|SLINGSHOT|telco
Orcon|ORCON|telco
Voyager|VOYAGER INTERNET,VOYAGER|telco
Snap Internet|SNAP INTERNET|telco
Bigpipe|BIGPIPE|telco
Starlink|STARLINK|telco
Kogan Mobile|KOGAN MOBILE|telco
Warehouse Mobile|WAREHOUSE MOBILE|telco
Hello Mobile|HELLO MOBILE|telco
Wireless Nation|WIRELESS NATION|telco
Farmside|FARMSIDE|telco
Now|NOW NZ|telco
Stuff Fibre|STUFF FIBRE|telco
Zeronet|ZERONET|telco
Mercury|MERCURY,MERCURY ENERGY,MERCURY NZ|power
Genesis|GENESIS,GENESIS ENERGY|power
Contact Energy|CONTACT ENERGY|power
Meridian|MERIDIAN,MERIDIAN ENERGY|power
Trustpower|TRUSTPOWER|power
Manawa Energy|MANAWA|power
Electric Kiwi|ELECTRIC KIWI|power
Flick Electric|FLICK,FLICK ELECTRIC|power
Powershop|POWERSHOP|power
Nova Energy|NOVA ENERGY,NOVA|power
Pulse Energy|PULSE ENERGY|power
Frank Energy|FRANK ENERGY|power
Octopus Energy|OCTOPUS ENERGY|power
Ecotricity|ECOTRICITY|power
Energy Online|ENERGY ONLINE|power
Globug|GLOBUG|power
Rockgas|ROCKGAS|power
Ongas|ONGAS|power
Elgas|ELGAS|power
Megatel|MEGATEL|telco
Watercare|WATERCARE|water
Wellington Water|WELLINGTON WATER|water
Inland Revenue|INLAND REVENUE,IRD,IR,INLAND REV|tax
ACC|ACC,ACCIDENT COMPENSATION,ACC LEVY|acc
Companies Office|COMPANIES OFFICE,NZ COMPANIES OFFICE,MBIE COMPANIES|government
MBIE|MBIE,MINISTRY OF BUSINESS|government
Tenancy Services|TENANCY SERVICES,TENANCY BOND,BOND CENTRE|bond
Ministry of Justice|MINISTRY OF JUSTICE,MOJ FINES,COURTS NZ|fines
NZ Police|NZ POLICE,NEW ZEALAND POLICE,POLICE INFRINGEMENT|fines
Department of Internal Affairs|INTERNAL AFFAIRS,DIA,PASSPORTS NZ|government
Land Information NZ|LINZ,LAND INFORMATION|government
Immigration NZ|IMMIGRATION NZ,IMMIGRATION NEW ZEALAND|government
NZ Customs|NZ CUSTOMS,CUSTOMS SERVICE|government
MPI|MPI,MINISTRY FOR PRIMARY|government
WorkSafe|WORKSAFE|government
Work and Income|WORK AND INCOME,WINZ,MSD|government
StudyLink|STUDYLINK|government
IPONZ|IPONZ|government
Kainga Ora|KAINGA ORA|government
NZ Post|NZ POST,NZPOST,NEW ZEALAND POST|courier
CourierPost|COURIERPOST,COURIER POST|courier
NZ Couriers|NZ COURIERS,NZCOURIERS|courier
Aramex|ARAMEX,FASTWAY|courier
PBT Couriers|PBT,PBT COURIERS|courier
Post Haste|POST HASTE|courier
Mainfreight|MAINFREIGHT|courier
DHL|DHL,DHL EXPRESS|courier
FedEx|FEDEX|courier
UPS|UPS|courier
Castle Parcels|CASTLE PARCELS|courier
Sendle|SENDLE|courier
GoSweetSpot|GOSWEETSPOT,GO SWEET SPOT|courier
Warehouse Stationery|WAREHOUSE STATIONERY,WHS|office
OfficeMax|OFFICEMAX,OFFICE MAX|office
Vistaprint|VISTAPRINT|office
Snap Print|SNAP PRINT|office
Kiwiprint|KIWIPRINT|office
Xero|XERO|accounting
MYOB|MYOB|accounting
QuickBooks|QUICKBOOKS,INTUIT|accounting
Hnry|HNRY|accounting
Thankyou Payroll|THANKYOU PAYROLL|payroll
Employment Hero|EMPLOYMENT HERO|payroll
iPayroll|IPAYROLL|payroll
Smartly|SMARTLY,SMART PAYROLL|payroll
PaySauce|PAYSAUCE|payroll
Deputy|DEPUTY|software
Microsoft|MICROSOFT,MSFT,MICROSOFT 365,OFFICE 365|software
Google Workspace|GOOGLE WORKSPACE,GSUITE,GOOGLE GSUITE|software
Google Cloud|GOOGLE CLOUD|software
Google One|GOOGLE ONE|streaming
Google Ads|GOOGLE ADS,GOOGLE ADWORDS,GOOGLE ADVERTISING|advertising
Apple|APPLE,APPLE COM,APPLE COM BILL,ITUNES|apple
Adobe|ADOBE|software
Dropbox|DROPBOX|software
Atlassian|ATLASSIAN|software
Canva|CANVA|software
Zoom|ZOOM US,ZOOM VIDEO,ZOOM COM|software
Slack|SLACK|software
Mailchimp|MAILCHIMP|software
Shopify|SHOPIFY|software
Squarespace|SQUARESPACE|hosting
Wix|WIX,WIX COM|hosting
WordPress|WORDPRESS,AUTOMATTIC|hosting
GoDaddy|GODADDY|hosting
1st Domains|1ST DOMAINS,FIRST DOMAINS|hosting
Freeparking|FREEPARKING|hosting
Crazy Domains|CRAZY DOMAINS|hosting
Namecheap|NAMECHEAP|hosting
Cloudflare|CLOUDFLARE|hosting
DigitalOcean|DIGITALOCEAN,DIGITAL OCEAN|hosting
Amazon Web Services|AWS,AMAZON WEB SERVICES|hosting
Netlify|NETLIFY|hosting
Vercel|VERCEL|hosting
GitHub|GITHUB|software
OpenAI|OPENAI,CHATGPT|software
Anthropic|ANTHROPIC,CLAUDE AI|software
Notion|NOTION|software
Asana|ASANA|software
Monday.com|MONDAY COM|software
Trello|TRELLO|software
DocuSign|DOCUSIGN|software
Calendly|CALENDLY|software
Grammarly|GRAMMARLY|software
LastPass|LASTPASS|software
1Password|1PASSWORD,AGILEBITS|software
Hootsuite|HOOTSUITE|software
SurveyMonkey|SURVEYMONKEY|software
Typeform|TYPEFORM|software
HubSpot|HUBSPOT|software
Salesforce|SALESFORCE|software
Zapier|ZAPIER|software
Figma|FIGMA|software
Webflow|WEBFLOW|hosting
Squarespace Domains|SQUARESPACE DOMAINS|hosting
Substack|SUBSTACK|streaming
Patreon|PATREON|streaming
Vend|VEND,LIGHTSPEED|software
Square|SQUARE,SQ|payments
Stripe|STRIPE,STRIPE PAYMENTS|payments
PayPal|PAYPAL|payments
Windcave|WINDCAVE,PAYMENT EXPRESS|payments
Paymark|PAYMARK,WORLDLINE|payments
Afterpay|AFTERPAY|payments
Laybuy|LAYBUY|payments
Zip|ZIP CO,ZIPPAY|payments
POLi|POLI|payments
Wise|WISE,TRANSFERWISE|transfer
Revolut|REVOLUT|transfer
Western Union|WESTERN UNION|transfer
OFX|OFX|transfer
Remitly|REMITLY|transfer
Swyftx|SWYFTX|crypto
Easy Crypto|EASY CRYPTO,EASYCRYPTO|crypto
Kraken|KRAKEN|crypto
Binance|BINANCE|crypto
Coinbase|COINBASE|crypto
Independent Reserve|INDEPENDENT RESERVE|crypto
Sharesies|SHARESIES|crypto
Hatch|HATCH INVEST|crypto
ANZ|ANZ,ANZ BANK|bank
ASB|ASB,ASB BANK|bank
BNZ|BNZ,BANK OF NEW ZEALAND|bank
Westpac|WESTPAC|bank
Kiwibank|KIWIBANK|bank
TSB|TSB,TSB BANK|bank
SBS Bank|SBS,SBS BANK|bank
Co-operative Bank|COOPERATIVE BANK,CO OPERATIVE BANK,THE CO OPERATIVE|bank
Heartland Bank|HEARTLAND|bank
Rabobank|RABOBANK|bank
HSBC|HSBC|bank
Bank of China|BANK OF CHINA|bank
AMEX|AMERICAN EXPRESS,AMEX|bank
Q Card|Q CARD,QCARD|bank
Gem Visa|GEM VISA,GEMVISA|bank
Harmoney|HARMONEY|bank
Squirrel|SQUIRREL MONEY|bank
UDC Finance|UDC|bank
AA Insurance|AA INSURANCE|insurance
AMI|AMI,AMI INSURANCE|insurance
State Insurance|STATE INSURANCE|insurance
NZI|NZI|insurance
Tower|TOWER,TOWER INSURANCE|insurance
Vero|VERO|insurance
FMG|FMG|insurance
IAG|IAG|insurance
Chubb|CHUBB INSURANCE|insurance
QBE|QBE|insurance
Ando Insurance|ANDO|insurance
Initio|INITIO|insurance
Protecta|PROTECTA|insurance
Star Insurance|STAR INSURANCE|insurance
Kiwi Insurance|KIWI INSURANCE|insurance
Cove Insurance|COVE INSURANCE,COVE|insurance
Real Insurance|REAL INSURANCE|healthInsurance
Southern Cross|SOUTHERN CROSS,SOUTHERN CROSS HEALTH|healthInsurance
nib|NIB|healthInsurance
AIA|AIA|healthInsurance
Partners Life|PARTNERS LIFE|healthInsurance
Fidelity Life|FIDELITY LIFE|healthInsurance
Accuro|ACCURO|healthInsurance
Asteron Life|ASTERON|healthInsurance
Pinnacle Life|PINNACLE LIFE|healthInsurance
Woolworths|WOOLWORTHS,COUNTDOWN,WW|supermarket
New World|NEW WORLD|supermarket
Pak'nSave|PAKNSAVE,PAK N SAVE|supermarket
Four Square|FOUR SQUARE,4 SQUARE|supermarket
FreshChoice|FRESHCHOICE,FRESH CHOICE|supermarket
SuperValue|SUPERVALUE,SUPER VALUE|supermarket
Costco|COSTCO|supermarket
Moore Wilson's|MOORE WILSON,MOORE WILSONS|supermarket
Farro|FARRO|supermarket
Raeward Fresh|RAEWARD|supermarket
Supie|SUPIE|supermarket
Bin Inn|BIN INN|supermarket
Commonsense Organics|COMMONSENSE ORGANICS|supermarket
Huckleberry|HUCKLEBERRY|supermarket
Gilmours|GILMOURS|supermarket
Trents|TRENTS|supermarket
Bidfood|BIDFOOD|supermarket
Night 'n Day|NIGHT N DAY,NIGHTNDAY|convenience
On the Spot|ON THE SPOT|convenience
Star Mart|STAR MART|convenience
McDonald's|MCDONALDS,MCDONALD|fastFood
KFC|KFC|fastFood
Burger King|BURGER KING|fastFood
Subway|SUBWAY|fastFood
Domino's|DOMINOS|fastFood
Pizza Hut|PIZZA HUT|fastFood
Hell Pizza|HELL PIZZA,HELL|fastFood
Starbucks|STARBUCKS|fastFood
Wendy's|WENDYS|fastFood
Carl's Jr|CARLS JR|fastFood
Nando's|NANDOS|fastFood
BurgerFuel|BURGERFUEL,BURGER FUEL|fastFood
Mexicali Fresh|MEXICALI|fastFood
Columbus Coffee|COLUMBUS COFFEE|fastFood
Muffin Break|MUFFIN BREAK|fastFood
Robert Harris|ROBERT HARRIS|fastFood
Wild Bean Cafe|WILD BEAN|fastFood
Mojo|MOJO COFFEE|fastFood
Sal's Pizza|SALS PIZZA,SALS|fastFood
Pita Pit|PITA PIT|fastFood
St Pierre's Sushi|ST PIERRES|fastFood
Gong Cha|GONG CHA|fastFood
Burger Burger|BURGER BURGER|fastFood
Uber Eats|UBER EATS,UBEREATS|foodDelivery
DoorDash|DOORDASH|foodDelivery
Delivereasy|DELIVEREASY|foodDelivery
Menulog|MENULOG|foodDelivery
My Food Bag|MY FOOD BAG,MYFOODBAG|foodDelivery
HelloFresh|HELLOFRESH,HELLO FRESH|foodDelivery
Bargain Box|BARGAIN BOX|foodDelivery
Liquorland|LIQUORLAND|liquor
Super Liquor|SUPER LIQUOR|liquor
Liquor King|LIQUOR KING|liquor
The Bottle-O|BOTTLE O,THE BOTTLE O|liquor
Glengarry|GLENGARRY|liquor
Thirsty Liquor|THIRSTY LIQUOR|liquor
Henry's|HENRYS BEER|liquor
Black Bull Liquor|BLACK BULL|liquor
Fine Wine Delivery|FINE WINE DELIVERY|liquor
Chemist Warehouse|CHEMIST WAREHOUSE|pharmacy
Unichem|UNICHEM|pharmacy
Life Pharmacy|LIFE PHARMACY|pharmacy
Bargain Chemist|BARGAIN CHEMIST|pharmacy
Pharmacy 547|PHARMACY 547|pharmacy
Amcal|AMCAL|pharmacy
Health 2000|HEALTH 2000|pharmacy
Bunnings|BUNNINGS,BUNNINGS WAREHOUSE|hardware
Mitre 10|MITRE 10,MITRE10|hardware
PlaceMakers|PLACEMAKERS|hardware
Carters|CARTERS|hardware
ITM|ITM|hardware
Hammer Hardware|HAMMER HARDWARE|hardware
Resene|RESENE|hardware
Dulux|DULUX|hardware
Plumbing World|PLUMBING WORLD|hardware
Mico|MICO|hardware
Burnsco|BURNSCO|outdoor
Corys Electrical|CORYS|hardware
JA Russell|JA RUSSELL|hardware
Ideal Electrical|IDEAL ELECTRICAL|hardware
Blackwoods|BLACKWOODS|hardware
Total Tools|TOTAL TOOLS|hardware
Toolshed|TOOLSHED|hardware
Hire Pool|HIREPOOL,HIRE POOL|hardware
Kennards Hire|KENNARDS|hardware
Steel and Tube|STEEL AND TUBE,STEEL TUBE|hardware
Kings Plant Barn|KINGS PLANT BARN|hardware
Palmers|PALMERS|hardware
Oderings|ODERINGS|hardware
Farmlands|FARMLANDS|farm
PGG Wrightson|PGG WRIGHTSON,PGG|farm
Noel Leeming|NOEL LEEMING|electronics
Harvey Norman|HARVEY NORMAN|electronics
JB Hi-Fi|JB HI FI,JBHIFI,JB HIFI|electronics
PB Tech|PB TECH,PBTECH|electronics
Smiths City|SMITHS CITY|electronics
Heathcote Appliances|HEATHCOTE|electronics
Jaycar|JAYCAR|electronics
Computer Lounge|COMPUTER LOUNGE|electronics
Mighty Ape|MIGHTY APE|marketplace
Dick Smith|DICK SMITH|electronics
Garmin|GARMIN|electronics
Dell|DELL|electronics
Lenovo|LENOVO|electronics
Samsung|SAMSUNG|electronics
The Warehouse|THE WAREHOUSE,WAREHOUSE|retail
Kmart|KMART|retail
Farmers|FARMERS|retail
Briscoes|BRISCOES|homeware
Rebel Sport|REBEL SPORT,REBEL|outdoor
Smith & Caughey's|SMITH CAUGHEY,SMITH AND CAUGHEY|retail
Ballantynes|BALLANTYNES|retail
David Jones|DAVID JONES|retail
Whitcoulls|WHITCOULLS|retail
Paper Plus|PAPER PLUS|retail
Unity Books|UNITY BOOKS|retail
Typo|TYPO|retail
Cotton On|COTTON ON|retail
Glassons|GLASSONS|retail
Hallenstein Brothers|HALLENSTEINS,HALLENSTEIN|retail
Postie|POSTIE|retail
Max|MAX FASHIONS|retail
Kathmandu|KATHMANDU|outdoor
Macpac|MACPAC|outdoor
Torpedo7|TORPEDO7,TORPEDO 7|outdoor
Hunting & Fishing|HUNTING FISHING,HUNTING AND FISHING|outdoor
Kiwi Outdoors|KIWI OUTDOORS|outdoor
Bivouac Outdoor|BIVOUAC|outdoor
Living Simply|LIVING SIMPLY|outdoor
Avanti Plus|AVANTI PLUS|outdoor
Number One Shoes|NUMBER ONE SHOES|retail
Hannahs|HANNAHS|retail
Platypus|PLATYPUS|retail
Athlete's Foot|ATHLETES FOOT|retail
Stirling Sports|STIRLING SPORTS|outdoor
Animates|ANIMATES|retail
Petstock|PETSTOCK|retail
Pet.co.nz|PET CO NZ|retail
Spotlight|SPOTLIGHT|homeware
Freedom Furniture|FREEDOM FURNITURE,FREEDOM|homeware
Bed Bath & Beyond|BED BATH|homeware
Stevens|STEVENS HOMEWARE,STEVENS STORE|homeware
Early Settler|EARLY SETTLER|homeware
Nood|NOOD|homeware
Harvey Furniture|HARVEY FURNITURE|homeware
Mocka|MOCKA|homeware
Adairs|ADAIRS|homeware
Ikea|IKEA|homeware
Citta|CITTA|homeware
Trade Depot|TRADE DEPOT|hardware
Daiso|DAISO|retail
Look Sharp|LOOK SHARP|retail
Toyworld|TOYWORLD|retail
Smiggle|SMIGGLE|retail
Lush|LUSH|retail
Mecca|MECCA|retail
Sephora|SEPHORA|retail
Michael Hill|MICHAEL HILL|retail
Pandora|PANDORA|retail
Specsavers|SPECSAVERS|retail
OPSM|OPSM|retail
Amazon|AMAZON,AMAZON RETA,AMAZON COM,AMZN|marketplace
AliExpress|ALIEXPRESS,ALIPAY|marketplace
Temu|TEMU|marketplace
Shein|SHEIN|marketplace
eBay|EBAY|marketplace
Trade Me|TRADE ME,TRADEME|marketplace
Etsy|ETSY|marketplace
The Market|THEMARKET,THE MARKET|marketplace
Facebook|FACEBOOK,FACEBK,META PLATFORMS|advertising
Instagram|INSTAGRAM|advertising
LinkedIn|LINKEDIN|advertising
Neighbourly|NEIGHBOURLY|advertising
Builderscrack|BUILDERSCRACK|advertising
NoCowboys|NOCOWBOYS|advertising
Yellow|YELLOW NZ,YELLOW PAGES|advertising
Stuff|STUFF LTD|advertising
NZME|NZME|advertising
Seek|SEEK|recruitment
Trade Me Jobs|TRADE ME JOBS|recruitment
Indeed|INDEED|recruitment
Netflix|NETFLIX|streaming
Spotify|SPOTIFY|streaming
Disney Plus|DISNEY PLUS,DISNEYPLUS|streaming
Neon|NEON|streaming
Sky|SKY TV,SKY NETWORK,SKY NZ|streaming
Amazon Prime|AMAZON PRIME,PRIME VIDEO|streaming
YouTube|YOUTUBE,YOUTUBE PREMIUM|streaming
Audible|AUDIBLE|streaming
Kindle|KINDLE|streaming
Apple Music|APPLE MUSIC|streaming
Steam|STEAM,STEAMPOWERED|streaming
PlayStation|PLAYSTATION,SONY PLAYSTATION|streaming
Nintendo|NINTENDO|streaming
Xbox|XBOX|streaming
NZ Herald|NZ HERALD,NZHERALD|streaming
The Spinoff|SPINOFF|streaming
CityFitness|CITYFITNESS,CITY FITNESS|gym
Les Mills|LES MILLS|gym
Anytime Fitness|ANYTIME FITNESS|gym
Snap Fitness|SNAP FITNESS|gym
Jetts|JETTS|gym
Flex Fitness|FLEX FITNESS|gym
Club Physical|CLUB PHYSICAL|gym
Evolve Fitness|EVOLVE FITNESS|gym
Event Cinemas|EVENT CINEMAS|entertainment
Hoyts|HOYTS|entertainment
Reading Cinemas|READING CINEMAS|entertainment
Rialto|RIALTO|entertainment
Ticketek|TICKETEK|entertainment
Ticketmaster|TICKETMASTER|entertainment
Eventfinda|EVENTFINDA|entertainment
iTICKET|ITICKET|entertainment
Lotto NZ|LOTTO,MYLOTTO|entertainment
TAB|TAB NZ,TAB|entertainment
SkyCity|SKYCITY,SKY CITY|entertainment
Timezone|TIMEZONE|entertainment
Salvation Army|SALVATION ARMY,THE SALVATION|charity
Red Cross|RED CROSS|charity
Starship Foundation|STARSHIP|charity
SPCA|SPCA|charity
Hospice|HOSPICE|charity
World Vision|WORLD VISION|charity
Oxfam|OXFAM|charity
UNICEF|UNICEF|charity
Greenpeace|GREENPEACE|charity
Forest & Bird|FOREST BIRD,FOREST AND BIRD|charity
Plunket|PLUNKET|charity
Cancer Society|CANCER SOCIETY|charity
Heart Foundation|HEART FOUNDATION|charity
St John|ST JOHN|charity
Habitat for Humanity|HABITAT FOR HUMANITY|charity
Save the Children|SAVE THE CHILDREN|charity
Barnardos|BARNARDOS|charity
Auckland Council|AUCKLAND COUNCIL,AKL COUNCIL|council
Wellington City Council|WELLINGTON CITY COUNCIL,WCC|council
Christchurch City Council|CHRISTCHURCH CITY COUNCIL,CCC|council
Hamilton City Council|HAMILTON CITY COUNCIL|council
Tauranga City Council|TAURANGA CITY COUNCIL|council
Dunedin City Council|DUNEDIN CITY COUNCIL|council
Palmerston North City Council|PALMERSTON NORTH CITY COUNCIL,PNCC|council
Nelson City Council|NELSON CITY COUNCIL,NELSON CITY|council
Tasman District Council|TASMAN DISTRICT COUNCIL,TASMAN DC|council
Marlborough District Council|MARLBOROUGH DISTRICT COUNCIL|council
Hutt City Council|HUTT CITY COUNCIL|council
Upper Hutt City Council|UPPER HUTT CITY COUNCIL|council
Porirua City Council|PORIRUA CITY COUNCIL|council
Kapiti Coast District Council|KAPITI COAST DISTRICT COUNCIL,KAPITI COAST DC|council
Whanganui District Council|WHANGANUI DISTRICT COUNCIL|council
Napier City Council|NAPIER CITY COUNCIL|council
Hastings District Council|HASTINGS DISTRICT COUNCIL|council
New Plymouth District Council|NEW PLYMOUTH DISTRICT COUNCIL,NPDC|council
Invercargill City Council|INVERCARGILL CITY COUNCIL|council
Queenstown Lakes District Council|QUEENSTOWN LAKES DISTRICT COUNCIL,QLDC|council
Rotorua Lakes Council|ROTORUA LAKES COUNCIL|council
Whangarei District Council|WHANGAREI DISTRICT COUNCIL|council
Far North District Council|FAR NORTH DISTRICT COUNCIL|council
Kaipara District Council|KAIPARA DISTRICT COUNCIL|council
Thames-Coromandel District Council|THAMES COROMANDEL DISTRICT COUNCIL,TCDC|council
Hauraki District Council|HAURAKI DISTRICT COUNCIL|council
Waikato District Council|WAIKATO DISTRICT COUNCIL|council
Matamata-Piako District Council|MATAMATA PIAKO DISTRICT COUNCIL|council
Waipa District Council|WAIPA DISTRICT COUNCIL|council
Otorohanga District Council|OTOROHANGA DISTRICT COUNCIL|council
South Waikato District Council|SOUTH WAIKATO DISTRICT COUNCIL|council
Waitomo District Council|WAITOMO DISTRICT COUNCIL|council
Taupo District Council|TAUPO DISTRICT COUNCIL|council
Western Bay of Plenty District Council|WESTERN BAY OF PLENTY DISTRICT COUNCIL|council
Whakatane District Council|WHAKATANE DISTRICT COUNCIL|council
Kawerau District Council|KAWERAU DISTRICT COUNCIL|council
Opotiki District Council|OPOTIKI DISTRICT COUNCIL|council
Gisborne District Council|GISBORNE DISTRICT COUNCIL|council
Wairoa District Council|WAIROA DISTRICT COUNCIL|council
Central Hawke's Bay District Council|CENTRAL HAWKES BAY DISTRICT COUNCIL|council
Ruapehu District Council|RUAPEHU DISTRICT COUNCIL|council
Rangitikei District Council|RANGITIKEI DISTRICT COUNCIL|council
Manawatu District Council|MANAWATU DISTRICT COUNCIL|council
Horowhenua District Council|HOROWHENUA DISTRICT COUNCIL|council
Tararua District Council|TARARUA DISTRICT COUNCIL|council
Masterton District Council|MASTERTON DISTRICT COUNCIL|council
Carterton District Council|CARTERTON DISTRICT COUNCIL|council
South Wairarapa District Council|SOUTH WAIRARAPA DISTRICT COUNCIL|council
Stratford District Council|STRATFORD DISTRICT COUNCIL|council
South Taranaki District Council|SOUTH TARANAKI DISTRICT COUNCIL|council
Buller District Council|BULLER DISTRICT COUNCIL|council
Grey District Council|GREY DISTRICT COUNCIL|council
Westland District Council|WESTLAND DISTRICT COUNCIL|council
Kaikoura District Council|KAIKOURA DISTRICT COUNCIL|council
Hurunui District Council|HURUNUI DISTRICT COUNCIL|council
Waimakariri District Council|WAIMAKARIRI DISTRICT COUNCIL|council
Selwyn District Council|SELWYN DISTRICT COUNCIL|council
Ashburton District Council|ASHBURTON DISTRICT COUNCIL|council
Timaru District Council|TIMARU DISTRICT COUNCIL|council
Mackenzie District Council|MACKENZIE DISTRICT COUNCIL|council
Waimate District Council|WAIMATE DISTRICT COUNCIL|council
Waitaki District Council|WAITAKI DISTRICT COUNCIL|council
Central Otago District Council|CENTRAL OTAGO DISTRICT COUNCIL|council
Clutha District Council|CLUTHA DISTRICT COUNCIL|council
Gore District Council|GORE DISTRICT COUNCIL|council
Southland District Council|SOUTHLAND DISTRICT COUNCIL|council
Chatham Islands Council|CHATHAM ISLANDS COUNCIL|council
Northland Regional Council|NORTHLAND REGIONAL COUNCIL|regionalCouncil
Waikato Regional Council|WAIKATO REGIONAL COUNCIL|regionalCouncil
Bay of Plenty Regional Council|BAY OF PLENTY REGIONAL COUNCIL,TOI MOANA|regionalCouncil
Hawke's Bay Regional Council|HAWKES BAY REGIONAL COUNCIL|regionalCouncil
Taranaki Regional Council|TARANAKI REGIONAL COUNCIL|regionalCouncil
Horizons Regional Council|HORIZONS REGIONAL COUNCIL,HORIZONS|regionalCouncil
Greater Wellington Regional Council|GREATER WELLINGTON,GWRC|regionalCouncil
Environment Canterbury|ENVIRONMENT CANTERBURY,ECAN|regionalCouncil
Otago Regional Council|OTAGO REGIONAL COUNCIL|regionalCouncil
Environment Southland|ENVIRONMENT SOUTHLAND|regionalCouncil
West Coast Regional Council|WEST COAST REGIONAL COUNCIL|regionalCouncil
Tradify|TRADIFY|software
Fergus|FERGUS SOFTWARE,FERGUSHQ|software
ServiceM8|SERVICEM8|software
simPRO|SIMPRO|software
AroFlo|AROFLO|software
Buildxact|BUILDXACT|software
WorkflowMax|WORKFLOWMAX,WORKFLOW MAX|software
Timely|TIMELY|software
Cliniko|CLINIKO|software
Nookal|NOOKAL|software
Mindbody|MINDBODY|software
Fresha|FRESHA|software
Unleashed|UNLEASHED SOFTWARE|software
Cin7|CIN7|software
Hubdoc|HUBDOC|accounting
Dext|DEXT,RECEIPT BANK|accounting
ApprovalMax|APPROVALMAX|accounting
Fathom|FATHOM HQ,FATHOMHQ|accounting
Syft|SYFT ANALYTICS|accounting
Ignition|IGNITION APP,PRACTICE IGNITION|accounting
Karbon|KARBON|accounting
FYI Docs|FYI DOCS,FYI SOFTWARE|accounting
FreshBooks|FRESHBOOKS|accounting
Wave|WAVE FINANCIAL,WAVEAPPS|accounting
Pipedrive|PIPEDRIVE|software
Zoho|ZOHO|software
Klaviyo|KLAVIYO|software
MailerLite|MAILERLITE|software
Constant Contact|CONSTANT CONTACT|software
Campaign Monitor|CAMPAIGN MONITOR|software
Buffer|BUFFER COM,BUFFER PUBLISHING|software
Later|LATER COM|software
Sprout Social|SPROUT SOCIAL|software
Loom|LOOM|software
Miro|MIRO COM,REALTIMEBOARD|software
Airtable|AIRTABLE|software
ClickUp|CLICKUP|software
Basecamp|BASECAMP|software
Todoist|TODOIST,DOIST|software
Evernote|EVERNOTE|software
Smartsheet|SMARTSHEET|software
Freshdesk|FRESHDESK,FRESHWORKS|software
Zendesk|ZENDESK|software
Intercom|INTERCOM|software
Twilio|TWILIO|software
SendGrid|SENDGRID|software
Mailgun|MAILGUN|software
Postmark|POSTMARK APP|software
Bitbucket|BITBUCKET|software
GitLab|GITLAB|software
JetBrains|JETBRAINS|software
Heroku|HEROKU|hosting
Linode|LINODE,AKAMAI CLOUD|hosting
Vultr|VULTR|hosting
Render|RENDER COM|hosting
Supabase|SUPABASE|hosting
MongoDB|MONGODB|hosting
Sentry|SENTRY|software
Datadog|DATADOG|software
Cloudinary|CLOUDINARY|hosting
Vimeo|VIMEO|software
Envato|ENVATO|software
Shutterstock|SHUTTERSTOCK|software
iStock|ISTOCK,GETTY IMAGES|software
Midjourney|MIDJOURNEY|software
Perplexity|PERPLEXITY|software
Cursor|CURSOR AI,ANYSPHERE|software
Descript|DESCRIPT|software
Otter.ai|OTTER AI|software
Acuity Scheduling|ACUITY|software
Gumroad|GUMROAD|payments
Teachable|TEACHABLE|software
Thinkific|THINKIFIC|software
Kajabi|KAJABI|software
Udemy|UDEMY|education
Coursera|COURSERA|education
LinkedIn Learning|LINKEDIN LEARNING,LYNDA|education
Skillshare|SKILLSHARE|education
Duolingo|DUOLINGO|streaming
Box|BOX COM,BOX INC|software
Backblaze|BACKBLAZE|software
iDrive|IDRIVE|software
Proton|PROTON AG,PROTONMAIL,PROTON VPN|software
NordVPN|NORDVPN,NORD SECURITY|software
ExpressVPN|EXPRESSVPN|software
Surfshark|SURFSHARK|software
Windscribe|WINDSCRIBE|software
Malwarebytes|MALWAREBYTES|software
Norton|NORTON,NORTONLIFELOCK,GEN DIGITAL|software
McAfee|MCAFEE|software
Kaspersky|KASPERSKY|software
Bitdefender|BITDEFENDER|software
Avast|AVAST|software
TeamViewer|TEAMVIEWER|software
AnyDesk|ANYDESK|software
Splashtop|SPLASHTOP|software
GoTo|GOTO COM,LOGMEIN|software
Webex|WEBEX,CISCO WEBEX|software
RingCentral|RINGCENTRAL|telco
Vonage|VONAGE|telco
Skype|SKYPE|telco
Dialpad|DIALPAD|telco
TikTok|TIKTOK,TIKTOK ADS|advertising
Pinterest|PINTEREST|advertising
Snapchat|SNAPCHAT,SNAP INC|advertising
X|X CORP,TWITTER|advertising
Microsoft Advertising|MICROSOFT ADVERTISING,BING ADS,MSFT ADS|advertising
Localist|LOCALIST|advertising
hipages|HIPAGES|advertising
realestate.co.nz|REALESTATE CO NZ|advertising
OneRoof|ONEROOF|advertising
Homes.co.nz|HOMES CO NZ|advertising
Trade Me Property|TRADE ME PROPERTY|advertising
Student Job Search|STUDENT JOB SEARCH,SJS|recruitment
ChargeNet|CHARGENET|evCharging
Jolt|JOLT CHARGE,JOLT|evCharging
Tesla Supercharger|TESLA SUPERCHARGER,TESLA SUPERCHARGING|evCharging
Tesla|TESLA|vehicle
Z Charge|Z CHARGE|evCharging
Paystation|PAYSTATION|payments
Smartpay|SMARTPAY|payments
Kogan|KOGAN COM,KOGAN|marketplace
Wish|WISH COM,CONTEXTLOGIC|marketplace
Booktopia|BOOKTOPIA|retail
Dymocks|DYMOCKS|retail
Nespresso|NESPRESSO|retail
Kitchen Things|KITCHEN THINGS|electronics
Foot Locker|FOOT LOCKER,FOOTLOCKER|retail
JD Sports|JD SPORTS|retail
Merchant 1948|MERCHANT 1948|retail
Witchery|WITCHERY|retail
Country Road|COUNTRY ROAD|retail
Seed Heritage|SEED HERITAGE|retail
Portmans|PORTMANS|retail
Jay Jays|JAY JAYS|retail
Factorie|FACTORIE|retail
Supre|SUPRE|retail
Rodd & Gunn|RODD GUNN,RODD AND GUNN|retail
Icebreaker|ICEBREAKER|outdoor
EziBuy|EZIBUY|retail
Shoe Clinic|SHOE CLINIC|retail
Overland|OVERLAND FOOTWEAR|retail
Wild Pair|WILD PAIR|retail
Mountain Warehouse|MOUNTAIN WAREHOUSE|outdoor
Pagani|PAGANI|retail
H&M|H M HENNES,HENNES MAURITZ,H AND M|retail
Zara online|ZARA COM|retail
Uniqlo|UNIQLO|retail
kikki.K|KIKKI K|retail
Wallace Cotton|WALLACE COTTON|homeware
Living & Giving|LIVING GIVING|homeware
Target Furniture|TARGET FURNITURE|homeware
Danske Mobler|DANSKE MOBLER|homeware
Forty Winks|FORTY WINKS|homeware
Beds R Us|BEDS R US,BEDSRUS|homeware
Bike Barn|BIKE BARN|outdoor
Trade Tested|TRADE TESTED|hardware
Coates Hire|COATES HIRE|hardware
Guthrie Bowron|GUTHRIE BOWRON|hardware
Edmac|EDMAC|hardware
Freightways|FREIGHTWAYS|courier
Toll|TOLL NZ,TOLL GROUP,TOLL IPEC|courier
TNT|TNT EXPRESS|courier
Urgent Couriers|URGENT COURIERS|courier
Kiwi Express|KIWI EXPRESS|courier
Taco Bell|TACO BELL|fastFood
Popeyes|POPEYES|fastFood
Better Burger|BETTER BURGER|fastFood
Shake Out|SHAKE OUT|fastFood
Tank|TANK JUICE|fastFood
Boost Juice|BOOST JUICE|fastFood
Chatime|CHATIME|fastFood
Krispy Kreme|KRISPY KREME|fastFood
Jamaica Blue|JAMAICA BLUE|fastFood
Gloria Jean's|GLORIA JEANS|fastFood
Esquires|ESQUIRES|fastFood
The Coffee Club|THE COFFEE CLUB,COFFEE CLUB|fastFood
Velvet Burger|VELVET BURGER|fastFood
Mad Mex|MAD MEX|fastFood
Bakers Delight|BAKERS DELIGHT|fastFood
Skyline|SKYLINE ROTORUA,SKYLINE QUEENSTOWN,SKYLINE ENTERPRISES|attraction
Hobbiton|HOBBITON|attraction
Te Papa|TE PAPA|attraction
Mt Hutt|MT HUTT,MOUNT HUTT|attraction
Cardrona|CARDRONA|attraction
Coronet Peak|CORONET PEAK|attraction
The Remarkables|THE REMARKABLES,REMARKABLES SKI|attraction
Mt Ruapehu|MT RUAPEHU,WHAKAPAPA SKI,TUROA|attraction
Treble Cone|TREBLE CONE|attraction
Rainbow's End|RAINBOWS END|attraction
Kelly Tarlton's|KELLY TARLTONS|attraction
Auckland Zoo|AUCKLAND ZOO|attraction
Wellington Zoo|WELLINGTON ZOO|attraction
Orana Wildlife Park|ORANA PARK,ORANA WILDLIFE|attraction
Zealandia|ZEALANDIA|attraction
Sky Tower|SKY TOWER|attraction
Shotover Jet|SHOTOVER JET|attraction
AJ Hackett|AJ HACKETT|attraction
Ramada|RAMADA|accommodation
Holiday Inn|HOLIDAY INN|accommodation
Crowne Plaza|CROWNE PLAZA|accommodation
InterContinental|INTERCONTINENTAL|accommodation
Hyatt|HYATT|accommodation
QT Hotels|QT HOTEL,QT QUEENSTOWN,QT WELLINGTON,QT AUCKLAND|accommodation
Heartland Hotels|HEARTLAND HOTEL|accommodation
Quality Hotel|QUALITY HOTEL|accommodation
Rendezvous Hotels|RENDEZVOUS HOTEL|accommodation
Marriott Hotels|MARRIOTT HOTEL,COURTYARD MARRIOTT,MARRIOTT INTERNATIONAL|accommodation
Southern Cross Travel Insurance|SOUTHERN CROSS TRAVEL,SCTI|insurance
Cover-More|COVER MORE,COVERMORE|insurance
1Cover|1COVER|insurance
World Nomads|WORLD NOMADS|insurance
MAS|MEDICAL ASSURANCE SOCIETY,MAS INSURANCE|insurance
Lumley|LUMLEY|insurance
Club Marine|CLUB MARINE|insurance
Youi|YOUI|insurance
Healthpost|HEALTHPOST|pharmacy
BestStart|BESTSTART,BEST START|childcare
Kindercare|KINDERCARE|childcare
Kidsfirst|KIDSFIRST|childcare
University of Auckland|UNIVERSITY OF AUCKLAND|education
Victoria University of Wellington|VICTORIA UNIVERSITY,TE HERENGA WAKA|education
University of Canterbury|UNIVERSITY OF CANTERBURY|education
University of Otago|UNIVERSITY OF OTAGO|education
Massey University|MASSEY UNIVERSITY,MASSEY UNI|education
University of Waikato|UNIVERSITY OF WAIKATO|education
AUT|AUCKLAND UNIVERSITY OF TECHNOLOGY,AUT|education
Lincoln University|LINCOLN UNIVERSITY|education
Te Pukenga|TE PUKENGA|education
Open Polytechnic|OPEN POLYTECHNIC|education
NZQA|NZQA,NZ QUALIFICATIONS AUTHORITY|government
Ministry of Education|MINISTRY OF EDUCATION|government
Health New Zealand|HEALTH NEW ZEALAND,TE WHATU ORA|government
Charities Services|CHARITIES SERVICES|government
Financial Markets Authority|FINANCIAL MARKETS AUTHORITY|government
Real Estate Authority|REAL ESTATE AUTHORITY|professional
Building Practitioners Board|BUILDING PRACTITIONERS|professional
Electrical Workers Registration Board|ELECTRICAL WORKERS REGISTRATION,EWRB|professional
Plumbers Gasfitters and Drainlayers Board|PLUMBERS GASFITTERS,PGDB|professional
NZ Law Society|NZ LAW SOCIETY,NEW ZEALAND LAW SOCIETY|professional
Chartered Accountants ANZ|CHARTERED ACCOUNTANTS AUSTRALIA,CA ANZ,CAANZ|professional
CPA Australia|CPA AUSTRALIA|professional
Engineering New Zealand|ENGINEERING NEW ZEALAND,ENGINEERING NZ|professional
Medical Council of NZ|MEDICAL COUNCIL|professional
Nursing Council of NZ|NURSING COUNCIL|professional
Teaching Council|TEACHING COUNCIL|professional
Master Builders|MASTER BUILDERS|professional
Master Electricians|MASTER ELECTRICIANS|professional
Master Plumbers|MASTER PLUMBERS|professional
BusinessNZ|BUSINESSNZ,BUSINESS NZ|professional
Chamber of Commerce|CHAMBER OF COMMERCE|professional
Otago Daily Times|OTAGO DAILY TIMES,ODT|news
Newsroom|NEWSROOM PRO|news
BusinessDesk|BUSINESSDESK|news
National Business Review|NATIONAL BUSINESS REVIEW,NBR|news
The Economist|THE ECONOMIST|news
New York Times|NEW YORK TIMES,NYTIMES|news
The Guardian|THE GUARDIAN,GUARDIAN NEWS|news
Medium|MEDIUM COM|news
Kidscan|KIDSCAN|charity
Women's Refuge|WOMENS REFUGE|charity
Ronald McDonald House|RONALD MCDONALD HOUSE|charity
Child Cancer Foundation|CHILD CANCER FOUNDATION|charity
Movember|MOVEMBER|charity
Givealittle|GIVEALITTLE|charity
Tear Fund|TEARFUND,TEAR FUND|charity
City Mission|CITY MISSION|charity
Paramount Plus|PARAMOUNT PLUS|streaming
Tidal|TIDAL MUSIC|streaming
Deezer|DEEZER|streaming
Kindle Unlimited|KINDLE UNLIMITED|streaming
Storytel|STORYTEL|streaming
Headspace|HEADSPACE|streaming
Calm|CALM COM|streaming
Strava|STRAVA|streaming
Zwift|ZWIFT|streaming
Google Play|GOOGLE PLAY|streaming
iHerb|IHERB|pharmacy
Pet Depot|PET DEPOT|retail
Mag & Turbo|MAG TURBO,MAG AND TURBO|vehicle
Tyre Warehouse|TYRE WAREHOUSE|vehicle
Autobarn|AUTOBARN|vehicle
Maui|MAUI MOTORHOMES,MAUI RENTALS|rentalCar
Britz|BRITZ|rentalCar
Wilderness Motorhomes|WILDERNESS MOTORHOMES|rentalCar
Turners|TURNERS AUCTIONS,TURNERS CARS|vehicle
Briscoes Online|BRISCOES ONLINE|homeware
Noel Leeming Online|NOEL LEEMING ONLINE|electronics
Mitre 10 Mega|MITRE 10 MEGA|hardware
Bunnings Trade|BUNNINGS TRADE|hardware
PlaceMakers Trade|PLACEMAKERS TRADE|hardware
Farmlands Card|FARMLANDS CARD|farm
Ravensdown|RAVENSDOWN|farm
Ballance Agri-Nutrients|BALLANCE AGRI|farm
LIC|LIVESTOCK IMPROVEMENT,LIC|farm
Wrightson Seeds|WRIGHTSON SEEDS|farm
Rural Supplies|RURAL SUPPLIES|farm
CRT|CRT FARMLANDS|farm
Carrfields|CARRFIELDS|farm
`;

export interface KnownBusiness {
  name: string;
  kind: BusinessKindName;
}

interface Alias {
  /** The alias without spaces or punctuation: what a run of words must spell. */
  compact: string;
  /** Written as one word, so trusted only where the payee starts. */
  oneWord: boolean;
  business: KnownBusiness;
}

/** Upper case, apostrophes dropped, everything else not a letter or digit a space. */
function words(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "");
}

let index: Map<string, Alias[]> | null = null;

/** The list, parsed once, by the first letter of each alias. */
function aliases(): Map<string, Alias[]> {
  if (index !== null) return index;
  index = new Map();
  for (const line of LIST.split("\n")) {
    const [name, said, kind] = line.split("|");
    if (name === undefined || said === undefined || kind === undefined || !(kind in BUSINESS_KINDS)) continue;
    const business: KnownBusiness = { name, kind: kind as BusinessKindName };
    for (const alias of new Set([name, ...said.split(",")])) {
      const parts = words(alias);
      const compact = parts.join("");
      if (compact === "") continue;
      const first = compact[0]!;
      const list = index.get(first) ?? [];
      list.push({ compact, oneWord: parts.length === 1, business });
      index.set(first, list);
    }
  }
  // Longest first, so "UBER EATS" is found before "UBER" and "AA INSURANCE"
  // before "AA".
  for (const list of index.values()) list.sort((a, b) => b.compact.length - a.compact.length);
  return index;
}

/** How many businesses the list knows. */
export function knownBusinessCount(): number {
  return LIST.split("\n").filter((line) => line.split("|").length === 3).length;
}

/** Words a bank puts before the payee, which are not the payee. */
const BANK_PREFIX = new Set(["POS", "EFTPOS", "EFT", "VISA", "DEBIT", "CARD", "PURCHASE", "DD", "AP", "W", "D", "WD"]);

/**
 * The business one piece of bank text names, or null.
 *
 * Tried at every word: a run of whole words must spell an alias exactly, so
 * "ZAPPY" is not "Z" and "ACCOUNTANT" is not "ACC". An alias of one word
 * counts only where the payee starts.
 */
export function businessIn(text: string): KnownBusiness | null {
  const tokens = words(text);
  const byFirst = aliases();
  let payee = 0;
  while (payee < tokens.length && (BANK_PREFIX.has(tokens[payee]!) || /^\d+$/.test(tokens[payee]!))) payee += 1;
  for (let start = payee; start < tokens.length; start += 1) {
    const candidates = byFirst.get(tokens[start]![0]!) ?? [];
    for (const alias of candidates) {
      if (alias.oneWord && start !== payee) continue;
      let spelt = "";
      for (let end = start; end < tokens.length && spelt.length < alias.compact.length; end += 1) {
        spelt += tokens[end];
        if (spelt === alias.compact) return alias.business;
      }
    }
  }
  return null;
}

/**
 * The business a bank line is with: the payee first, then the other fields a
 * bank puts names in when the payee is only "DD PAYMENT" or "EFTPOS".
 */
export function businessOf(line: {
  otherParty?: string;
  particulars?: string;
  code?: string;
  reference?: string;
}): KnownBusiness | null {
  for (const field of [line.otherParty, line.particulars, line.code, line.reference]) {
    if (field === undefined || field.trim() === "") continue;
    const found = businessIn(field);
    if (found !== null) return found;
  }
  return null;
}

/** One line saying what a business is: "Z Energy, a fuel station". */
export function describeBusiness(business: KnownBusiness): string {
  return `${business.name}: ${BUSINESS_KINDS[business.kind].what}`;
}

/**
 * The one account in a chart that money spent with this business belongs to,
 * or null when the kind does not settle it or the chart has no single fit.
 *
 * Given only accounts that could take spending -- the caller leaves out bank,
 * receivable, payable and the rest -- and for one entity's accounts where the
 * bank account serves one.
 */
export function accountForBusiness(
  business: KnownBusiness,
  accounts: readonly { label: string; name: string }[],
  paidAbroad = false,
): string | null {
  const kind: BusinessKind = BUSINESS_KINDS[business.kind];
  const patterns: readonly RegExp[] = (paidAbroad ? kind.abroad : undefined) ?? kind.accounts ?? [];
  for (const pattern of patterns) {
    const fits = accounts.filter((account) => pattern.test(account.name));
    if (fits.length === 1) return fits[0]!.label;
    if (fits.length > 1) return null;
  }
  return null;
}
