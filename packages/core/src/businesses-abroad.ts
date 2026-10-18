/**
 * The known-business lists for books kept outside New Zealand: Australia's,
 * the United States', and the global businesses every country's bank lines
 * are with. New Zealand's list, with its own global names in it, is in
 * nz-businesses.ts, which reads these.
 *
 * The same rules as New Zealand's: large national and well-known businesses
 * and public bodies only, never a local business. Each entry is
 * "Name|ALIASES|kind", the aliases as banks write the name.
 */

/** Businesses known the world over, for every country's books but New Zealand's (whose list has them). */
export const GLOBAL_LIST = `
Avis|AVIS|rentalCar
Hertz|HERTZ|rentalCar
Budget Rent a Car|BUDGET RENT,BUDGET CAR|rentalCar
Europcar|EUROPCAR|rentalCar
Thrifty|THRIFTY|rentalCar
Enterprise Rent-A-Car|ENTERPRISE RENT|rentalCar
Sixt|SIXT|rentalCar
Singapore Airlines|SINGAPORE AIRLINES,SINGAPORE AIR|overseasAirline
Emirates|EMIRATES|overseasAirline
Cathay Pacific|CATHAY PACIFIC|overseasAirline
Korean Air|KOREAN AIR|overseasAirline
Japan Airlines|JAPAN AIRLINES,JAL|overseasAirline
ANA|ALL NIPPON,ANA AIRWAYS|overseasAirline
Qatar Airways|QATAR AIRWAYS,QATAR AIR|overseasAirline
Etihad|ETIHAD|overseasAirline
British Airways|BRITISH AIRWAYS,BRITISH AIR|overseasAirline
Lufthansa|LUFTHANSA|overseasAirline
Air France|AIR FRANCE|overseasAirline
KLM|KLM|overseasAirline
Turkish Airlines|TURKISH AIRLINES|overseasAirline
LATAM|LATAM|overseasAirline
Fiji Airways|FIJI AIRWAYS|overseasAirline
China Southern|CHINA SOUTHERN|overseasAirline
Malaysia Airlines|MALAYSIA AIRLINES|overseasAirline
Thai Airways|THAI AIRWAYS|overseasAirline
Philippine Airlines|PHILIPPINE AIRLINES|overseasAirline
AirAsia|AIRASIA,AIR ASIA|overseasAirline
Scoot|SCOOT|overseasAirline
Booking.com|BOOKING COM,BOOKINGCOM|bookingSite
Airbnb|AIRBNB|bookingSite
Expedia|EXPEDIA|bookingSite
Hotels.com|HOTELS COM,HOTELSCOM|bookingSite
Agoda|AGODA|bookingSite
Trivago|TRIVAGO|bookingSite
Trip.com|TRIP COM,CTRIP|bookingSite
Accor|ACCOR,NOVOTEL,IBIS,MERCURE,SOFITEL,PULLMAN|accommodation
Hilton|HILTON HOTEL,HILTON HOTELS,HAMPTON INN,DOUBLETREE,EMBASSY SUITES|accommodation
Marriott Hotels|MARRIOTT,COURTYARD MARRIOTT,RESIDENCE INN,FAIRFIELD INN,SHERATON,WESTIN|accommodation
Hyatt|HYATT|accommodation
Holiday Inn|HOLIDAY INN|accommodation
Crowne Plaza|CROWNE PLAZA|accommodation
InterContinental|INTERCONTINENTAL,IHG HOTELS|accommodation
Ramada|RAMADA|accommodation
Best Western|BEST WESTERN|accommodation
Rydges|RYDGES|accommodation
Uber|UBER,UBER TRIP,UBER BV|transport
Xero|XERO|accounting
MYOB|MYOB|accounting
QuickBooks|QUICKBOOKS,INTUIT|accounting
FreshBooks|FRESHBOOKS|accounting
Wave|WAVE FINANCIAL,WAVEAPPS|accounting
Hubdoc|HUBDOC|accounting
Dext|DEXT,RECEIPT BANK|accounting
ApprovalMax|APPROVALMAX|accounting
Fathom|FATHOM HQ,FATHOMHQ|accounting
Karbon|KARBON|accounting
Ignition|IGNITION APP,PRACTICE IGNITION|accounting
Deputy|DEPUTY|software
Microsoft|MICROSOFT,MSFT,MICROSOFT 365,OFFICE 365|software
Google Workspace|GOOGLE WORKSPACE,GSUITE,GOOGLE GSUITE|software
Google Cloud|GOOGLE CLOUD|software
Google One|GOOGLE ONE|streaming
Google Ads|GOOGLE ADS,GOOGLE ADWORDS,GOOGLE ADVERTISING|advertising
Google Play|GOOGLE PLAY|streaming
Apple|APPLE,APPLE COM,APPLE COM BILL,ITUNES|apple
Apple Music|APPLE MUSIC|streaming
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
Namecheap|NAMECHEAP|hosting
Cloudflare|CLOUDFLARE|hosting
DigitalOcean|DIGITALOCEAN,DIGITAL OCEAN|hosting
Amazon Web Services|AWS,AMAZON WEB SERVICES|hosting
Netlify|NETLIFY|hosting
Vercel|VERCEL|hosting
Hostinger|HOSTINGER|hosting
SiteGround|SITEGROUND|hosting
Webflow|WEBFLOW|hosting
Heroku|HEROKU|hosting
Linode|LINODE,AKAMAI CLOUD|hosting
Vultr|VULTR|hosting
Render|RENDER COM|hosting
Supabase|SUPABASE|hosting
MongoDB|MONGODB|hosting
Cloudinary|CLOUDINARY|hosting
GitHub|GITHUB|software
GitLab|GITLAB|software
Bitbucket|BITBUCKET|software
JetBrains|JETBRAINS|software
OpenAI|OPENAI,CHATGPT|software
Anthropic|ANTHROPIC,CLAUDE AI|software
Midjourney|MIDJOURNEY|software
Perplexity|PERPLEXITY|software
Cursor|CURSOR AI,ANYSPHERE|software
Notion|NOTION|software
Asana|ASANA|software
Monday.com|MONDAY COM|software
Trello|TRELLO|software
ClickUp|CLICKUP|software
Airtable|AIRTABLE|software
Basecamp|BASECAMP|software
Smartsheet|SMARTSHEET|software
Miro|MIRO COM,REALTIMEBOARD|software
Loom|LOOM|software
Figma|FIGMA|software
DocuSign|DOCUSIGN|software
Calendly|CALENDLY|software
Grammarly|GRAMMARLY|software
LastPass|LASTPASS|software
1Password|1PASSWORD,AGILEBITS|software
HubSpot|HUBSPOT|software
Salesforce|SALESFORCE|software
Pipedrive|PIPEDRIVE|software
Zoho|ZOHO|software
Zapier|ZAPIER|software
Klaviyo|KLAVIYO|software
MailerLite|MAILERLITE|software
Constant Contact|CONSTANT CONTACT|software
Hootsuite|HOOTSUITE|software
Buffer|BUFFER COM,BUFFER PUBLISHING|software
SurveyMonkey|SURVEYMONKEY|software
Typeform|TYPEFORM|software
Zendesk|ZENDESK|software
Freshdesk|FRESHDESK,FRESHWORKS|software
Intercom|INTERCOM|software
Twilio|TWILIO|software
SendGrid|SENDGRID|software
Sentry|SENTRY|software
Datadog|DATADOG|software
Vimeo|VIMEO|software
Envato|ENVATO|software
Shutterstock|SHUTTERSTOCK|software
iStock|ISTOCK,GETTY IMAGES|software
Descript|DESCRIPT|software
Otter.ai|OTTER AI|software
Teachable|TEACHABLE|software
Thinkific|THINKIFIC|software
Kajabi|KAJABI|software
Box|BOX COM,BOX INC|software
Backblaze|BACKBLAZE|software
Proton|PROTON AG,PROTONMAIL,PROTON VPN|software
NordVPN|NORDVPN,NORD SECURITY|software
ExpressVPN|EXPRESSVPN|software
Malwarebytes|MALWAREBYTES|software
Norton|NORTON,NORTONLIFELOCK,GEN DIGITAL|software
McAfee|MCAFEE|software
Bitdefender|BITDEFENDER|software
TeamViewer|TEAMVIEWER|software
AnyDesk|ANYDESK|software
GoTo|GOTO COM,LOGMEIN|software
Webex|WEBEX,CISCO WEBEX|software
Square|SQUARE,SQ|payments
Stripe|STRIPE,STRIPE PAYMENTS|payments
PayPal|PAYPAL|payments
Gumroad|GUMROAD|payments
Afterpay|AFTERPAY|payments
Klarna|KLARNA|payments
Wise|WISE,TRANSFERWISE|transfer
Revolut|REVOLUT|transfer
Western Union|WESTERN UNION|transfer
Remitly|REMITLY|transfer
WorldRemit|WORLDREMIT|transfer
Kraken|KRAKEN|crypto
Binance|BINANCE|crypto
Coinbase|COINBASE|crypto
Uber Eats|UBER EATS,UBEREATS|foodDelivery
DoorDash|DOORDASH|foodDelivery
HelloFresh|HELLOFRESH,HELLO FRESH|foodDelivery
Garmin|GARMIN|electronics
Dell|DELL|electronics
Lenovo|LENOVO|electronics
Samsung|SAMSUNG|electronics
HP|HP STORE,HP INC|electronics
Amazon|AMAZON,AMAZON RETA,AMAZON COM,AMZN|marketplace
AliExpress|ALIEXPRESS,ALIPAY|marketplace
Temu|TEMU|marketplace
Shein|SHEIN|marketplace
eBay|EBAY|marketplace
Etsy|ETSY|marketplace
Wish|WISH COM,CONTEXTLOGIC|marketplace
IKEA|IKEA|homeware
Uniqlo|UNIQLO|retail
Facebook|FACEBOOK,FACEBK,META PLATFORMS|advertising
Instagram|INSTAGRAM|advertising
LinkedIn|LINKEDIN|advertising
TikTok|TIKTOK,TIKTOK ADS|advertising
Pinterest|PINTEREST|advertising
Snapchat|SNAPCHAT,SNAP INC|advertising
X|X CORP,TWITTER|advertising
Microsoft Advertising|MICROSOFT ADVERTISING,BING ADS,MSFT ADS|advertising
Indeed|INDEED|recruitment
Netflix|NETFLIX|streaming
Spotify|SPOTIFY|streaming
Disney Plus|DISNEY PLUS,DISNEYPLUS|streaming
Paramount Plus|PARAMOUNT PLUS|streaming
Amazon Prime|AMAZON PRIME,PRIME VIDEO|streaming
YouTube|YOUTUBE,YOUTUBE PREMIUM|streaming
Audible|AUDIBLE|streaming
Kindle|KINDLE|streaming
Steam|STEAM,STEAMPOWERED|streaming
PlayStation|PLAYSTATION,SONY PLAYSTATION|streaming
Nintendo|NINTENDO|streaming
Xbox|XBOX|streaming
Headspace|HEADSPACE|streaming
Calm|CALM COM|streaming
Strava|STRAVA|streaming
Duolingo|DUOLINGO|streaming
Patreon|PATREON|streaming
Substack|SUBSTACK|streaming
The Economist|THE ECONOMIST|news
New York Times|NEW YORK TIMES,NYTIMES|news
The Guardian|THE GUARDIAN,GUARDIAN NEWS|news
Medium|MEDIUM COM|news
DHL|DHL|courier
FedEx|FEDEX|courier
Vistaprint|VISTAPRINT|office
Coursera|COURSERA|education
Udemy|UDEMY|education
LinkedIn Learning|LINKEDIN LEARNING|education
MasterClass|MASTERCLASS|education
Tesla|TESLA SUPERCHARGER,TESLA CHARGING|evCharging
`;

/** Businesses most Australians' bank lines are with. */
export const AU_LIST = `
Ampol|AMPOL,CALTEX,AMPOL FOODARY|fuel
BP|BP,BP CONNECT,BP EXPRESS|fuel
Shell|SHELL,SHELL COLES EXPRESS,REDDY EXPRESS,COLES EXPRESS|fuel
7-Eleven|7 ELEVEN,7ELEVEN,SEVEN ELEVEN|fuel
United Petroleum|UNITED PETROLEUM,UNITED FUEL|fuel
Puma Energy|PUMA ENERGY|fuel
Liberty Oil|LIBERTY OIL,LIBERTY FUEL|fuel
Metro Petroleum|METRO PETROLEUM,METRO FUEL|fuel
Mobil|MOBIL|fuel
EG Australia|EG AUSTRALIA,EG FUELCO|fuel
On the Run|ON THE RUN,OTR|fuel
Costco Fuel|COSTCO FUEL|fuel
Supercheap Auto|SUPERCHEAP AUTO,SUPERCHEAP|vehicle
Repco|REPCO|vehicle
Autobarn|AUTOBARN|vehicle
Bob Jane T-Marts|BOB JANE,BOB JANE T MARTS|vehicle
Beaurepaires|BEAUREPAIRES|vehicle
Goodyear Autocare|GOODYEAR|vehicle
Midas|MIDAS|vehicle
Ultra Tune|ULTRA TUNE,ULTRATUNE|vehicle
Kmart Tyre and Auto|KMART TYRE,KTAS|vehicle
Pedders|PEDDERS|vehicle
Tyrepower|TYREPOWER|vehicle
JAX Tyres|JAX TYRES|vehicle
Mycar|MYCAR TYRE,MYCAR|vehicle
Transport for NSW|TRANSPORT FOR NSW,TFNSW,ROADS AND MARITIME|vehicleLicence
VicRoads|VICROADS|vehicleLicence
Transport and Main Roads Queensland|TMR QLD,QLD TRANSPORT,DEPT TRANSPORT MAIN ROADS|vehicleLicence
Department of Transport WA|DOT WA,DEPT OF TRANSPORT WA|vehicleLicence
Service SA|SERVICE SA|vehicleLicence
Linkt|LINKT,TRANSURBAN|tolls
EastLink|EASTLINK|tolls
E-Toll|E TOLL,ETOLL|tolls
Wilson Parking|WILSON PARKING,WILSONS PARKING|parking
Secure Parking|SECURE PARKING|parking
Care Park|CARE PARK,CAREPARK|parking
Cellopark|CELLOPARK|parking
PayStay|PAYSTAY|parking
EasyPark|EASYPARK|parking
Opal|OPAL,OPAL TRANSPORT|transport
Myki|MYKI,PTV|transport
Translink|TRANSLINK,GO CARD|transport
Transperth|TRANSPERTH,SMARTRIDER|transport
Adelaide Metro|ADELAIDE METRO,METROCARD|transport
DiDi|DIDI,DIDI MOBILITY|transport
Ola|OLA CABS|transport
13CABS|13CABS,13 CABS|transport
Silver Top Taxis|SILVER TOP|transport
Spirit of Tasmania|SPIRIT OF TASMANIA|transport
Redspot|REDSPOT|rentalCar
East Coast Car Rentals|EAST COAST CAR|rentalCar
Bayswater Car Rental|BAYSWATER CAR|rentalCar
GoGet|GOGET,GO GET CARSHARE|rentalCar
Flexicar|FLEXICAR|rentalCar
Qantas|QANTAS,QANTASLINK,QANTAS AIRWAYS|airline
Virgin Australia|VIRGIN AUSTRALIA,VIRGIN AUST|airline
Jetstar|JETSTAR|airline
Rex|REGIONAL EXPRESS,REX AIRLINES|domesticAirline
Air New Zealand|AIR NEW ZEALAND,AIR NZ|overseasAirline
Quest Apartment Hotels|QUEST APARTMENT,QUEST APARTMENTS|accommodation
Oaks Hotels|OAKS HOTELS,OAKS HOTEL|accommodation
Mantra|MANTRA|accommodation
Meriton Suites|MERITON SUITES,MERITON|accommodation
Adina Apartment Hotels|ADINA|accommodation
Choice Hotels|CHOICE HOTELS,COMFORT INN,QUALITY INN|accommodation
BIG4 Holiday Parks|BIG4,BIG 4 HOLIDAY|accommodation
Discovery Parks|DISCOVERY PARKS|accommodation
NRMA Parks and Resorts|NRMA PARKS|accommodation
Stayz|STAYZ|bookingSite
Wotif|WOTIF|bookingSite
Webjet|WEBJET|bookingSite
Flight Centre|FLIGHT CENTRE|bookingSite
Telstra|TELSTRA|telco
Optus|OPTUS|telco
Vodafone|VODAFONE|telco
TPG|TPG,TPG INTERNET|telco
iiNet|IINET|telco
Aussie Broadband|AUSSIE BROADBAND|telco
Belong|BELONG|telco
Dodo|DODO|telco
Superloop|SUPERLOOP|telco
Exetel|EXETEL|telco
Amaysim|AMAYSIM|telco
Boost Mobile|BOOST MOBILE|telco
Southern Phone|SOUTHERN PHONE|telco
Tangerine|TANGERINE TELECOM|telco
Spintel|SPINTEL|telco
Kogan Mobile|KOGAN MOBILE|telco
Lebara|LEBARA|telco
Felix Mobile|FELIX MOBILE|telco
Starlink|STARLINK|telco
AGL|AGL|power
Origin Energy|ORIGIN ENERGY|power
EnergyAustralia|ENERGYAUSTRALIA,ENERGY AUSTRALIA|power
Red Energy|RED ENERGY|power
Alinta Energy|ALINTA|power
Simply Energy|SIMPLY ENERGY|power
Momentum Energy|MOMENTUM ENERGY|power
Powershop|POWERSHOP|power
Lumo Energy|LUMO ENERGY|power
Energy Locals|ENERGY LOCALS|power
Amber Electric|AMBER ELECTRIC|power
Ergon Energy|ERGON ENERGY|power
Synergy|SYNERGY|power
Aurora Energy|AURORA ENERGY|power
ActewAGL|ACTEWAGL|power
Tango Energy|TANGO ENERGY|power
GloBird Energy|GLOBIRD|power
OVO Energy|OVO ENERGY|power
Sydney Water|SYDNEY WATER|water
Yarra Valley Water|YARRA VALLEY WATER|water
South East Water|SOUTH EAST WATER|water
Greater Western Water|GREATER WESTERN WATER|water
SA Water|SA WATER|water
Water Corporation|WATER CORPORATION,WATER CORP|water
Urban Utilities|URBAN UTILITIES|water
Unitywater|UNITYWATER|water
Hunter Water|HUNTER WATER|water
Icon Water|ICON WATER|water
TasWater|TASWATER|water
Barwon Water|BARWON WATER|water
City of Sydney|CITY OF SYDNEY|council
Brisbane City Council|BRISBANE CITY COUNCIL,BCC RATES|council
City of Melbourne|CITY OF MELBOURNE|council
City of Gold Coast|CITY OF GOLD COAST,GOLD COAST CITY COUNCIL|council
Moreton Bay|MORETON BAY|council
Logan City Council|LOGAN CITY COUNCIL|council
City of Perth|CITY OF PERTH|council
City of Adelaide|CITY OF ADELAIDE|council
Hobart City Council|HOBART CITY COUNCIL|council
City of Darwin|CITY OF DARWIN|council
Sunshine Coast Council|SUNSHINE COAST COUNCIL|council
City of Newcastle|CITY OF NEWCASTLE|council
Blacktown City Council|BLACKTOWN CITY COUNCIL|council
Central Coast Council|CENTRAL COAST COUNCIL|council
City of Geelong|CITY OF GREATER GEELONG,CITY OF GEELONG|council
AAMI|AAMI|insurance
NRMA Insurance|NRMA INSURANCE,NRMA|insurance
RACV|RACV|insurance
RACQ|RACQ|insurance
RAA|RAA|insurance
RAC WA|RAC WA,RAC INSURANCE|insurance
Suncorp Insurance|SUNCORP INSURANCE|insurance
Allianz|ALLIANZ|insurance
QBE|QBE|insurance
Budget Direct|BUDGET DIRECT|insurance
Youi|YOUI|insurance
GIO|GIO|insurance
CGU|CGU|insurance
Real Insurance|REAL INSURANCE|insurance
Bingle|BINGLE|insurance
Hollard|HOLLARD|insurance
Zurich|ZURICH|insurance
BizCover|BIZCOVER|insurance
Medibank|MEDIBANK|healthInsurance
Bupa|BUPA|healthInsurance
HCF|HCF|healthInsurance
nib|NIB HEALTH,NIB|healthInsurance
ahm|AHM HEALTH,AHM|healthInsurance
HBF|HBF|healthInsurance
Australian Unity|AUSTRALIAN UNITY|healthInsurance
GMHBA|GMHBA|healthInsurance
TAL|TAL LIFE|healthInsurance
icare|ICARE NSW,ICARE|workersComp
WorkSafe Victoria|WORKSAFE VICTORIA,WORKSAFE VIC|workersComp
WorkCover Queensland|WORKCOVER QUEENSLAND,WORKCOVER QLD|workersComp
ReturnToWorkSA|RETURNTOWORKSA,RETURN TO WORK SA|workersComp
WorkCover WA|WORKCOVER WA|workersComp
Commonwealth Bank|COMMONWEALTH BANK,COMMBANK,CBA|bank
Westpac|WESTPAC|bank
ANZ|ANZ|bank
NAB|NAB,NATIONAL AUSTRALIA BANK|bank
St.George Bank|ST GEORGE BANK,ST GEORGE|bank
Bank of Melbourne|BANK OF MELBOURNE|bank
BankSA|BANKSA,BANK SA|bank
ING|ING,ING DIRECT|bank
Macquarie Bank|MACQUARIE BANK|bank
Bankwest|BANKWEST|bank
Suncorp Bank|SUNCORP BANK|bank
Bendigo Bank|BENDIGO BANK,BENDIGO AND ADELAIDE|bank
Bank of Queensland|BANK OF QUEENSLAND,BOQ|bank
ME Bank|ME BANK|bank
Ubank|UBANK|bank
Up|UP BANK|bank
Great Southern Bank|GREAT SOUTHERN BANK|bank
Heritage Bank|HERITAGE BANK|bank
Newcastle Permanent|NEWCASTLE PERMANENT|bank
American Express|AMERICAN EXPRESS,AMEX|bank
Australian Taxation Office|ATO,AUSTRALIAN TAXATION OFFICE,ATO PAYMENTS,TAX OFFICE PAYMENTS|tax
Revenue NSW|REVENUE NSW|government
State Revenue Office Victoria|STATE REVENUE OFFICE,SRO VIC|government
Queensland Revenue Office|QUEENSLAND REVENUE OFFICE,QLD REVENUE OFFICE|government
ASIC|ASIC|government
Service NSW|SERVICE NSW|government
Access Canberra|ACCESS CANBERRA|government
Services Australia|SERVICES AUSTRALIA,CENTRELINK,MEDICARE BENEFITS|government
NSW Fair Trading Rental Bonds|NSW FAIR TRADING,RENTAL BONDS ONLINE|bond
Residential Tenancies Bond Authority|RTBA|bond
Residential Tenancies Authority|RTA QLD,RESIDENTIAL TENANCIES AUTHORITY|bond
Woolworths|WOOLWORTHS,WOOLIES|supermarket
Coles|COLES|supermarket
Aldi|ALDI|supermarket
IGA|IGA|supermarket
FoodWorks|FOODWORKS|supermarket
Harris Farm Markets|HARRIS FARM|supermarket
Costco|COSTCO|supermarket
Drakes|DRAKES SUPERMARKET,DRAKES|supermarket
NightOwl|NIGHTOWL,NIGHT OWL|convenience
Ezymart|EZYMART|convenience
McDonald's|MCDONALDS,MCDONALD S|fastFood
Hungry Jack's|HUNGRY JACKS|fastFood
KFC|KFC|fastFood
Subway|SUBWAY|fastFood
Domino's|DOMINOS|fastFood
Red Rooster|RED ROOSTER|fastFood
Guzman y Gomez|GUZMAN Y GOMEZ,GYG|fastFood
Grill'd|GRILLD|fastFood
Nando's|NANDOS|fastFood
Oporto|OPORTO|fastFood
Zambrero|ZAMBRERO|fastFood
Starbucks|STARBUCKS|fastFood
Gloria Jean's|GLORIA JEANS|fastFood
Boost Juice|BOOST JUICE|fastFood
Muffin Break|MUFFIN BREAK|fastFood
Pizza Hut|PIZZA HUT|fastFood
Mad Mex|MAD MEX|fastFood
Menulog|MENULOG|foodDelivery
Marley Spoon|MARLEY SPOON|foodDelivery
Dinnerly|DINNERLY|foodDelivery
Youfoodz|YOUFOODZ|foodDelivery
Dan Murphy's|DAN MURPHYS|liquor
BWS|BWS|liquor
Liquorland|LIQUORLAND|liquor
First Choice Liquor|FIRST CHOICE LIQUOR|liquor
Vintage Cellars|VINTAGE CELLARS|liquor
Bottlemart|BOTTLEMART|liquor
Cellarbrations|CELLARBRATIONS|liquor
Chemist Warehouse|CHEMIST WAREHOUSE|pharmacy
Priceline Pharmacy|PRICELINE PHARMACY,PRICELINE|pharmacy
TerryWhite Chemmart|TERRYWHITE,TERRY WHITE,CHEMMART|pharmacy
Amcal|AMCAL|pharmacy
Blooms The Chemist|BLOOMS THE CHEMIST|pharmacy
Discount Drug Stores|DISCOUNT DRUG STORES|pharmacy
Bunnings|BUNNINGS,BUNNINGS WAREHOUSE|hardware
Mitre 10|MITRE 10,MITRE10|hardware
Home Hardware|HOME HARDWARE|hardware
Total Tools|TOTAL TOOLS|hardware
Sydney Tools|SYDNEY TOOLS|hardware
Reece Plumbing|REECE PLUMBING,REECE AUSTRALIA|hardware
Tradelink|TRADELINK|hardware
Middy's|MIDDYS|hardware
Officeworks|OFFICEWORKS|office
Kwik Kopy|KWIK KOPY|office
Australia Post|AUSTRALIA POST,AUSPOST,AUST POST|courier
StarTrack|STARTRACK|courier
Sendle|SENDLE|courier
CouriersPlease|COURIERS PLEASE,COURIERSPLEASE|courier
Toll|TOLL GROUP,TOLL IPEC|courier
Aramex|ARAMEX,FASTWAY|courier
TNT|TNT EXPRESS,TNT|courier
Shippit|SHIPPIT|courier
Allied Express|ALLIED EXPRESS|courier
Reckon|RECKON|accounting
Employment Hero|EMPLOYMENT HERO|payroll
KeyPay|KEYPAY|payroll
Tanda|TANDA|software
Tradify|TRADIFY|software
ServiceM8|SERVICEM8|software
simPRO|SIMPRO|software
AroFlo|AROFLO|software
Cliniko|CLINIKO|software
Nookal|NOOKAL|software
Timely|TIMELY|software
Crazy Domains|CRAZY DOMAINS|hosting
VentraIP|VENTRAIP|hosting
Netregistry|NETREGISTRY|hosting
realestate.com.au|REALESTATE COM AU,REA GROUP|advertising
Domain|DOMAIN COM AU,DOMAIN GROUP|advertising
hipages|HIPAGES|advertising
Oneflare|ONEFLARE|advertising
ServiceSeeking|SERVICESEEKING|advertising
Seek|SEEK|recruitment
Jora|JORA|recruitment
JB Hi-Fi|JB HI FI,JBHIFI,JB HIFI|electronics
Harvey Norman|HARVEY NORMAN|electronics
The Good Guys|THE GOOD GUYS,GOOD GUYS|electronics
Bing Lee|BING LEE|electronics
Jaycar|JAYCAR|electronics
Centre Com|CENTRE COM|electronics
Scorptec|SCORPTEC|electronics
Mwave|MWAVE|electronics
MSY Technology|MSY|electronics
Kmart|KMART|retail
Target|TARGET|retail
Big W|BIG W|retail
Myer|MYER|retail
David Jones|DAVID JONES|retail
Best and Less|BEST AND LESS,BEST LESS|retail
The Reject Shop|REJECT SHOP|retail
Daiso|DAISO|retail
Cotton On|COTTON ON|retail
Country Road|COUNTRY ROAD|retail
Rebel|REBEL SPORT,REBEL|outdoor
BCF|BCF|outdoor
Anaconda|ANACONDA|outdoor
Kathmandu|KATHMANDU|outdoor
Macpac|MACPAC|outdoor
Decathlon|DECATHLON|outdoor
Snowys Outdoors|SNOWYS|outdoor
Freedom Furniture|FREEDOM FURNITURE|homeware
Fantastic Furniture|FANTASTIC FURNITURE|homeware
Amart Furniture|AMART FURNITURE,AMART|homeware
Adairs|ADAIRS|homeware
Bed Bath N' Table|BED BATH N TABLE,BED BATH AND TABLE|homeware
Spotlight|SPOTLIGHT|homeware
Lincraft|LINCRAFT|homeware
Temple and Webster|TEMPLE AND WEBSTER,TEMPLE WEBSTER|homeware
Nick Scali|NICK SCALI|homeware
Koala|KOALA COM|homeware
Beacon Lighting|BEACON LIGHTING|homeware
Gumtree|GUMTREE|marketplace
Catch|CATCH COM AU,CATCH OF THE DAY|marketplace
Kogan|KOGAN COM,KOGAN|marketplace
Tyro|TYRO|payments
Zip|ZIP CO,ZIPPAY,ZIP PAY|payments
Humm|HUMM|payments
Smartpay|SMARTPAY|payments
eWAY|EWAY|payments
Pin Payments|PIN PAYMENTS|payments
OFX|OFX|transfer
CoinSpot|COINSPOT|crypto
Swyftx|SWYFTX|crypto
Independent Reserve|INDEPENDENT RESERVE|crypto
BTC Markets|BTC MARKETS|crypto
CommSec|COMMSEC|investment
Stake Trading|STAKE TRADING,HELLOSTAKE|investment
Raiz|RAIZ|investment
Spaceship|SPACESHIP|investment
Pearler|PEARLER|investment
SelfWealth|SELFWEALTH|investment
Superhero|SUPERHERO|investment
Stan|STAN COM AU,STAN ENTERTAINMENT|streaming
Foxtel|FOXTEL|streaming
Kayo Sports|KAYO|streaming
Binge|BINGE|streaming
The Australian|THE AUSTRALIAN|news
Australian Financial Review|AUSTRALIAN FINANCIAL REVIEW,AFR|news
Sydney Morning Herald|SYDNEY MORNING HERALD,SMH|news
The Age|THE AGE|news
Herald Sun|HERALD SUN|news
Anytime Fitness|ANYTIME FITNESS|gym
Snap Fitness|SNAP FITNESS|gym
Fitness First|FITNESS FIRST|gym
Goodlife Health Clubs|GOODLIFE HEALTH|gym
Jetts|JETTS|gym
F45|F45|gym
Plus Fitness|PLUS FITNESS|gym
Crunch Fitness|CRUNCH FITNESS|gym
Virgin Active|VIRGIN ACTIVE|gym
Event Cinemas|EVENT CINEMAS|entertainment
Hoyts|HOYTS|entertainment
Village Cinemas|VILLAGE CINEMAS|entertainment
Reading Cinemas|READING CINEMAS|entertainment
Ticketek|TICKETEK|entertainment
Ticketmaster|TICKETMASTER|entertainment
Australian Red Cross|AUSTRALIAN RED CROSS,RED CROSS|charity
The Salvation Army|SALVATION ARMY,SALVOS|charity
Vinnies|VINNIES,ST VINCENT DE PAUL|charity
The Smith Family|SMITH FAMILY|charity
Cancer Council|CANCER COUNCIL|charity
World Vision|WORLD VISION|charity
Oxfam|OXFAM|charity
UNICEF|UNICEF|charity
Beyond Blue|BEYOND BLUE|charity
CPA Australia|CPA AUSTRALIA|professional
Chartered Accountants ANZ|CHARTERED ACCOUNTANTS ANZ,CA ANZ|professional
AHPRA|AHPRA|professional
Master Builders|MASTER BUILDERS|professional
Housing Industry Association|HOUSING INDUSTRY ASSOCIATION,HIA|professional
Master Plumbers|MASTER PLUMBERS|professional
Engineers Australia|ENGINEERS AUSTRALIA|professional
TAFE NSW|TAFE NSW|education
TAFE Queensland|TAFE QUEENSLAND|education
Open Universities Australia|OPEN UNIVERSITIES AUSTRALIA|education
Goodstart Early Learning|GOODSTART|childcare
Chargefox|CHARGEFOX|evCharging
Evie Networks|EVIE NETWORKS|evCharging
Elders|ELDERS|farm
Nutrien Ag Solutions|NUTRIEN AG,LANDMARK|farm
`;

/** Businesses most Americans' bank lines are with. */
export const US_LIST = `
Shell|SHELL,SHELL OIL,SHELL SERVICE|fuel
ExxonMobil|EXXON,EXXONMOBIL,EXXON MOBIL|fuel
Mobil|MOBIL|fuel
Chevron|CHEVRON|fuel
BP|BP,BP PRODUCTS|fuel
Speedway|SPEEDWAY|fuel
Marathon|MARATHON PETRO,MARATHON GAS|fuel
Sunoco|SUNOCO|fuel
Valero|VALERO|fuel
Circle K|CIRCLE K|fuel
Wawa|WAWA|fuel
Sheetz|SHEETZ|fuel
QuikTrip|QUIKTRIP,QT|fuel
RaceTrac|RACETRAC|fuel
Casey's|CASEYS,CASEY S GEN|fuel
Pilot Flying J|PILOT FLYING J,PILOT TRAVEL,FLYING J|fuel
Love's|LOVES TRAVEL,LOVE S COUNTRY|fuel
Kwik Trip|KWIK TRIP,KWIK STAR|fuel
Murphy USA|MURPHY USA,MURPHY EXPRESS|fuel
Costco Gas|COSTCO GAS|fuel
Phillips 66|PHILLIPS 66|fuel
Conoco|CONOCO|fuel
Citgo|CITGO|fuel
Gulf|GULF OIL|fuel
Holiday Stationstores|HOLIDAY STATIONSTORES,HOLIDAY STNSTORE|fuel
Thorntons|THORNTONS|fuel
Buc-ee's|BUC EES,BUCEES|fuel
Cumberland Farms|CUMBERLAND FARMS|fuel
Maverik|MAVERIK|fuel
AutoZone|AUTOZONE|vehicle
O'Reilly Auto Parts|OREILLY AUTO,O REILLY AUTO|vehicle
Advance Auto Parts|ADVANCE AUTO|vehicle
NAPA Auto Parts|NAPA AUTO,NAPA STORE|vehicle
Pep Boys|PEP BOYS|vehicle
Jiffy Lube|JIFFY LUBE|vehicle
Valvoline|VALVOLINE|vehicle
Firestone|FIRESTONE|vehicle
Goodyear|GOODYEAR|vehicle
Discount Tire|DISCOUNT TIRE|vehicle
Les Schwab|LES SCHWAB|vehicle
Midas|MIDAS|vehicle
Meineke|MEINEKE|vehicle
Safelite|SAFELITE|vehicle
Take 5 Oil Change|TAKE 5 OIL,TAKE 5|vehicle
Mavis Tires|MAVIS TIRE,MAVIS DISCOUNT|vehicle
Monro|MONRO|vehicle
DMV|DMV,DEPT OF MOTOR VEHICLES,DEPARTMENT OF MOTOR VEHICLES,CA DMV,CALIFORNIA DMV,OREGON DMV,WASHINGTON DOL,NYS DMV,NY DMV,TEXAS DMV,TXDMV,FLHSMV,FLORIDA HSMV,ARIZONA MVD,NEVADA DMV,VIRGINIA DMV,GEORGIA DOR MV|vehicleLicence
E-ZPass|EZPASS,E ZPASS,E Z PASS|tolls
SunPass|SUNPASS|tolls
FasTrak|FASTRAK|tolls
TxTag|TXTAG|tolls
NTTA|NTTA,NORTH TEXAS TOLLWAY|tolls
Peach Pass|PEACH PASS|tolls
I-PASS|IPASS,I PASS,ILLINOIS TOLLWAY|tolls
Good To Go|GOOD TO GO WSDOT|tolls
SpotHero|SPOTHERO|parking
ParkMobile|PARKMOBILE|parking
LAZ Parking|LAZ PARKING|parking
SP+|SP PLUS,SP PARKING|parking
ParkWhiz|PARKWHIZ|parking
PayByPhone|PAYBYPHONE|parking
Impark|IMPARK|parking
Premium Parking|PREMIUM PARKING|parking
Lyft|LYFT|transport
Amtrak|AMTRAK|transport
MTA|MTA,MTA NYCT,OMNY|transport
BART|BART,BAY AREA RAPID TRANSIT|transport
WMATA|WMATA,SMARTRIP|transport
Ventra|VENTRA,CTA|transport
Clipper Card|CLIPPER CARD|transport
SEPTA|SEPTA|transport
MBTA|MBTA,CHARLIECARD|transport
National Car Rental|NATIONAL CAR RENTAL,NATIONAL CAR|rentalCar
Alamo Rent a Car|ALAMO RENT,ALAMO CAR|rentalCar
Dollar Rent A Car|DOLLAR RENT,DOLLAR CAR|rentalCar
Turo|TURO|rentalCar
Zipcar|ZIPCAR|rentalCar
Delta Air Lines|DELTA AIR,DELTA AIRLINES|airline
United Airlines|UNITED AIRLINES,UNITED AIR|airline
American Airlines|AMERICAN AIRLINES,AMERICAN AIR,AA COM|airline
Alaska Airlines|ALASKA AIRLINES,ALASKA AIR|airline
JetBlue|JETBLUE|airline
Hawaiian Airlines|HAWAIIAN AIRLINES,HAWAIIAN AIR|airline
Southwest Airlines|SOUTHWEST AIRLINES,SOUTHWEST AIR,SWA|domesticAirline
Spirit Airlines|SPIRIT AIRLINES,SPIRIT AIRL|domesticAirline
Frontier Airlines|FRONTIER AIRLINES,FRONTIER AIR|domesticAirline
Allegiant|ALLEGIANT|domesticAirline
Sun Country|SUN COUNTRY|domesticAirline
Air New Zealand|AIR NEW ZEALAND,AIR NZ|overseasAirline
Qantas|QANTAS|overseasAirline
Air Canada|AIR CANADA|overseasAirline
Wyndham Hotels|WYNDHAM,SUPER 8,DAYS INN,LA QUINTA,RAMADA INN|accommodation
Choice Hotels|CHOICE HOTELS,COMFORT INN,QUALITY INN,SLEEP INN|accommodation
Motel 6|MOTEL 6|accommodation
Extended Stay America|EXTENDED STAY|accommodation
Red Roof|RED ROOF|accommodation
Sonesta|SONESTA|accommodation
Omni Hotels|OMNI HOTELS,OMNI HOTEL|accommodation
Loews Hotels|LOEWS HOTEL,LOEWS HOTELS|accommodation
KOA|KOA,KAMPGROUNDS OF AMERICA|accommodation
Vrbo|VRBO,HOMEAWAY|bookingSite
Priceline|PRICELINE|bookingSite
Kayak|KAYAK|bookingSite
Orbitz|ORBITZ|bookingSite
Travelocity|TRAVELOCITY|bookingSite
Hotwire|HOTWIRE|bookingSite
Verizon|VERIZON,VERIZON WIRELESS,VZWRLSS|telco
AT&T|ATT,AT T,AT&T|telco
T-Mobile|T MOBILE,TMOBILE|telco
Xfinity|XFINITY,COMCAST|telco
Spectrum Internet|SPECTRUM,CHARTER COMM|telco
Cox Communications|COX COMM,COX CABLE|telco
Optimum Online|OPTIMUM,ALTICE|telco
Frontier Communications|FRONTIER COMM,FRONTIER COMMUNICATIONS|telco
CenturyLink|CENTURYLINK,LUMEN|telco
Google Fi|GOOGLE FI|telco
Mint Mobile|MINT MOBILE|telco
Cricket Wireless|CRICKET WIRELESS|telco
Metro by T-Mobile|METRO BY T MOBILE,METROPCS|telco
Boost Mobile|BOOST MOBILE|telco
Visible|VISIBLE WIRELESS|telco
US Cellular|US CELLULAR|telco
Starlink|STARLINK|telco
RingCentral|RINGCENTRAL|telco
Vonage|VONAGE|telco
Ooma|OOMA|telco
Dialpad|DIALPAD|telco
PG&E|PG E,PGANDE,PACIFIC GAS|power
Southern California Edison|SO CAL EDISON,SOUTHERN CALIFORNIA EDISON,SCE|power
Duke Energy|DUKE ENERGY|power
Dominion Energy|DOMINION ENERGY|power
Florida Power & Light|FPL,FLORIDA POWER|power
Georgia Power|GEORGIA POWER|power
Con Edison|CON ED,CONED,CONSOLIDATED EDISON|power
National Grid|NATIONAL GRID|power
Xcel Energy|XCEL ENERGY|power
DTE Energy|DTE ENERGY|power
Consumers Energy|CONSUMERS ENERGY|power
Entergy|ENTERGY|power
AEP|AEP,AMERICAN ELECTRIC POWER|power
ComEd|COMED|power
PSE&G|PSEG,PSE G|power
PPL Electric|PPL ELECTRIC|power
Eversource|EVERSOURCE|power
Ameren|AMEREN|power
TXU Energy|TXU ENERGY|power
Reliant Energy|RELIANT ENERGY|power
CenterPoint Energy|CENTERPOINT ENERGY|power
SoCalGas|SOCALGAS,SO CAL GAS|power
Puget Sound Energy|PUGET SOUND ENERGY|power
Pepco|PEPCO|power
BGE|BGE,BALTIMORE GAS|power
APS|ARIZONA PUBLIC SERVICE,APS ELECTRIC|power
SRP|SALT RIVER PROJECT,SRP POWER|power
NV Energy|NV ENERGY|power
Rocky Mountain Power|ROCKY MOUNTAIN POWER|power
Portland General Electric|PORTLAND GENERAL ELECTRIC,PGE PORTLAND|power
Evergy|EVERGY|power
Alliant Energy|ALLIANT ENERGY|power
We Energies|WE ENERGIES|power
Atmos Energy|ATMOS ENERGY|power
Nicor Gas|NICOR GAS|power
Spire|SPIRE ENERGY,SPIRE GAS|power
American Water|AMERICAN WATER|water
Aqua|AQUA AMERICA,ESSENTIAL UTILITIES|water
LADWP|LADWP,LA DWP|water
County Treasurer|COUNTY TREASURER,TREASURER TAX COLLECTOR,TAX COLLECTOR|council
State Farm|STATE FARM|insurance
GEICO|GEICO|insurance
Progressive Insurance|PROGRESSIVE INS,PROGRESSIVE CASUALTY|insurance
Allstate|ALLSTATE|insurance
Liberty Mutual|LIBERTY MUTUAL|insurance
Farmers Insurance|FARMERS INSURANCE,FARMERS INS|insurance
Nationwide|NATIONWIDE|insurance
USAA|USAA|insurance
Travelers|TRAVELERS INS,TRAVELERS|insurance
American Family Insurance|AMERICAN FAMILY INS,AMFAM|insurance
The Hartford|THE HARTFORD,HARTFORD INS|insurance
Hiscox|HISCOX|insurance
NEXT Insurance|NEXT INSURANCE|insurance
Chubb|CHUBB|insurance
Erie Insurance|ERIE INSURANCE|insurance
Lemonade Insurance|LEMONADE INS|insurance
Thimble|THIMBLE|insurance
UnitedHealthcare|UNITEDHEALTHCARE,UNITED HEALTHCARE,UHC|healthInsurance
Aetna|AETNA|healthInsurance
Cigna|CIGNA|healthInsurance
Anthem|ANTHEM|healthInsurance
Blue Cross Blue Shield|BLUE CROSS,BCBS,BLUE SHIELD|healthInsurance
Humana|HUMANA|healthInsurance
Kaiser Permanente|KAISER PERMANENTE,KAISER|healthInsurance
Oscar Health|OSCAR HEALTH|healthInsurance
MetLife|METLIFE|healthInsurance
Prudential|PRUDENTIAL|healthInsurance
Northwestern Mutual|NORTHWESTERN MUTUAL|healthInsurance
New York Life|NEW YORK LIFE|healthInsurance
Chase|CHASE,JPMORGAN CHASE|bank
Bank of America|BANK OF AMERICA,BOFA,BKOFAMERICA|bank
Wells Fargo|WELLS FARGO|bank
Citi|CITI,CITIBANK|bank
Capital One|CAPITAL ONE|bank
U.S. Bank|US BANK,U S BANK,USBANK|bank
PNC|PNC|bank
Truist|TRUIST|bank
TD Bank|TD BANK|bank
Ally Bank|ALLY BANK,ALLY|bank
Discover Card|DISCOVER|bank
American Express|AMERICAN EXPRESS,AMEX|bank
Synchrony|SYNCHRONY|bank
Navy Federal|NAVY FEDERAL,NAVY FCU|bank
SoFi|SOFI|bank
Chime|CHIME|bank
Mercury Bank|MERCURY BANK,MERCURY TECH|bank
Relay|RELAY FINANCIAL,RELAYFI|bank
Novo|NOVO BANK,NOVO PLATFORM|bank
Bluevine|BLUEVINE|bank
Citizens Bank|CITIZENS BANK|bank
Fifth Third|FIFTH THIRD|bank
KeyBank|KEYBANK,KEY BANK|bank
Huntington|HUNTINGTON|bank
Regions|REGIONS BANK|bank
M&T Bank|M T BANK,M&T BANK|bank
BMO|BMO|bank
Santander|SANTANDER|bank
Brex|BREX|bank
Ramp|RAMP CARD,RAMP BUSINESS|bank
Internal Revenue Service|IRS,IRS USATAXPYMT,IRS TREAS,EFTPS,US TREASURY|tax
Franchise Tax Board|FRANCHISE TAX BOARD,FTB|tax
New York State Tax|NYS DTF|tax
Texas Comptroller|TX COMPTROLLER,TEXAS COMPTROLLER|tax
Secretary of State|SECRETARY OF STATE,SEC OF STATE|government
USPS|USPS,US POSTAL SERVICE,STAMPS COM|courier
UPS|UPS,THE UPS STORE|courier
Pirate Ship|PIRATE SHIP,PIRATESHIP|courier
ShipStation|SHIPSTATION|courier
Shippo|SHIPPO|courier
EasyPost|EASYPOST|courier
Walmart|WALMART,WAL MART,WM SUPERCENTER|retail
Target|TARGET|retail
Kroger|KROGER|supermarket
Albertsons|ALBERTSONS|supermarket
Safeway|SAFEWAY|supermarket
Publix|PUBLIX|supermarket
H-E-B|H E B,HEB|supermarket
Whole Foods|WHOLE FOODS,WFM|supermarket
Trader Joe's|TRADER JOES,TRADER JOE S|supermarket
Aldi|ALDI|supermarket
Costco|COSTCO|supermarket
Sam's Club|SAMS CLUB,SAM S CLUB|supermarket
BJ's Wholesale|BJS WHOLESALE|supermarket
Meijer|MEIJER|supermarket
Wegmans|WEGMANS|supermarket
Food Lion|FOOD LION|supermarket
Giant Food|GIANT FOOD,GIANT EAGLE|supermarket
Stop & Shop|STOP SHOP,STOP AND SHOP|supermarket
Harris Teeter|HARRIS TEETER|supermarket
ShopRite|SHOPRITE|supermarket
Sprouts|SPROUTS|supermarket
WinCo|WINCO|supermarket
Hy-Vee|HY VEE,HYVEE|supermarket
Ralphs|RALPHS|supermarket
Fred Meyer|FRED MEYER|supermarket
Vons|VONS|supermarket
Jewel-Osco|JEWEL OSCO|supermarket
King Soopers|KING SOOPERS|supermarket
Winn-Dixie|WINN DIXIE|supermarket
7-Eleven|7 ELEVEN,7ELEVEN,SEVEN ELEVEN|convenience
McDonald's|MCDONALDS,MCDONALD S|fastFood
Starbucks|STARBUCKS|fastFood
Chick-fil-A|CHICK FIL A,CHICKFILA|fastFood
Taco Bell|TACO BELL|fastFood
Wendy's|WENDYS|fastFood
Burger King|BURGER KING|fastFood
Subway|SUBWAY|fastFood
Dunkin'|DUNKIN|fastFood
Chipotle|CHIPOTLE|fastFood
Domino's|DOMINOS|fastFood
Pizza Hut|PIZZA HUT|fastFood
Panera Bread|PANERA|fastFood
Sonic Drive-In|SONIC DRIVE|fastFood
Popeyes|POPEYES|fastFood
KFC|KFC|fastFood
Arby's|ARBYS|fastFood
Jack in the Box|JACK IN THE BOX|fastFood
Panda Express|PANDA EXPRESS|fastFood
Five Guys|FIVE GUYS|fastFood
In-N-Out|IN N OUT|fastFood
Jimmy John's|JIMMY JOHNS|fastFood
Jersey Mike's|JERSEY MIKES|fastFood
Whataburger|WHATABURGER|fastFood
Little Caesars|LITTLE CAESARS|fastFood
Papa John's|PAPA JOHNS|fastFood
Dairy Queen|DAIRY QUEEN|fastFood
Shake Shack|SHAKE SHACK|fastFood
Sweetgreen|SWEETGREEN|fastFood
Wingstop|WINGSTOP|fastFood
Raising Cane's|RAISING CANES|fastFood
Tim Hortons|TIM HORTONS|fastFood
Peet's Coffee|PEETS COFFEE,PEET S|fastFood
Dutch Bros|DUTCH BROS|fastFood
Grubhub|GRUBHUB|foodDelivery
Instacart|INSTACART|foodDelivery
Gopuff|GOPUFF|foodDelivery
Postmates|POSTMATES|foodDelivery
Blue Apron|BLUE APRON|foodDelivery
Home Chef|HOME CHEF|foodDelivery
Total Wine|TOTAL WINE|liquor
BevMo|BEVMO|liquor
Spec's|SPECS WINE,SPEC S|liquor
Binny's|BINNYS|liquor
CVS|CVS,CVS PHARMACY|pharmacy
Walgreens|WALGREENS|pharmacy
Rite Aid|RITE AID|pharmacy
Home Depot|HOME DEPOT,THE HOME DEPOT|hardware
Lowe's|LOWES,LOWE S|hardware
Menards|MENARDS|hardware
Ace Hardware|ACE HARDWARE|hardware
True Value|TRUE VALUE|hardware
Harbor Freight|HARBOR FREIGHT|hardware
Northern Tool|NORTHERN TOOL|hardware
Grainger|GRAINGER|hardware
Fastenal|FASTENAL|hardware
Ferguson Enterprises|FERGUSON ENTERPRISES,FERGUSON PLUMBING|hardware
Sherwin-Williams|SHERWIN WILLIAMS|hardware
Floor & Decor|FLOOR DECOR,FLOOR AND DECOR|hardware
84 Lumber|EIGHTY FOUR LUMBER|hardware
Staples|STAPLES|office
Office Depot|OFFICE DEPOT,OFFICEMAX,OFFICE MAX|office
FedEx Office|FEDEX OFFICE|office
Intuit|INTUIT QBOOKS,QUICKBOOKS ONLINE|accounting
Bill.com|BILL COM,BILL COM INC|accounting
Expensify|EXPENSIFY|accounting
Gusto|GUSTO|payroll
ADP|ADP,ADP PAYROLL|payroll
Paychex|PAYCHEX|payroll
Rippling|RIPPLING|payroll
Justworks|JUSTWORKS|payroll
TriNet|TRINET|payroll
OnPay|ONPAY|payroll
Paylocity|PAYLOCITY|payroll
Paycom|PAYCOM|payroll
Paycor|PAYCOR|payroll
Jobber|JOBBER|software
Housecall Pro|HOUSECALL PRO|software
ServiceTitan|SERVICETITAN|software
Bluehost|BLUEHOST|hosting
HostGator|HOSTGATOR|hosting
DreamHost|DREAMHOST|hosting
WP Engine|WP ENGINE,WPENGINE|hosting
Yelp|YELP|advertising
Nextdoor|NEXTDOOR|advertising
Angi|ANGI,ANGIES LIST,HOMEADVISOR|advertising
Thumbtack|THUMBTACK|advertising
Thryv|THRYV,YELLOW PAGES|advertising
Reddit Ads|REDDIT|advertising
ZipRecruiter|ZIPRECRUITER|recruitment
Glassdoor|GLASSDOOR|recruitment
Monster|MONSTER COM,MONSTER WORLDWIDE|recruitment
Best Buy|BEST BUY,BESTBUY|electronics
B&H Photo|B H PHOTO,BH PHOTO|electronics
Newegg|NEWEGG|electronics
Micro Center|MICRO CENTER|electronics
Adorama|ADORAMA|electronics
Macy's|MACYS|retail
Kohl's|KOHLS|retail
Nordstrom|NORDSTROM|retail
TJ Maxx|TJ MAXX,TJMAXX|retail
Marshalls|MARSHALLS|retail
Ross|ROSS STORES|retail
Burlington|BURLINGTON|retail
JCPenney|JCPENNEY,JC PENNEY|retail
Dollar General|DOLLAR GENERAL|retail
Dollar Tree|DOLLAR TREE|retail
Family Dollar|FAMILY DOLLAR|retail
Five Below|FIVE BELOW|retail
Old Navy|OLD NAVY|retail
Gap|GAP STORE,GAP INC|retail
REI|REI,REI COM|outdoor
Dick's Sporting Goods|DICKS SPORTING|outdoor
Bass Pro Shops|BASS PRO|outdoor
Cabela's|CABELAS|outdoor
Academy Sports|ACADEMY SPORTS|outdoor
Patagonia|PATAGONIA|outdoor
Wayfair|WAYFAIR|homeware
HomeGoods|HOMEGOODS|homeware
Pottery Barn|POTTERY BARN|homeware
Williams-Sonoma|WILLIAMS SONOMA|homeware
Crate & Barrel|CRATE BARREL,CRATE AND BARREL|homeware
West Elm|WEST ELM|homeware
Ashley Furniture|ASHLEY FURNITURE,ASHLEY HOMESTORE|homeware
Rooms To Go|ROOMS TO GO|homeware
The Container Store|CONTAINER STORE|homeware
Michaels Stores|MICHAELS STORES,MICHAELS ARTS|homeware
Hobby Lobby|HOBBY LOBBY|homeware
Joann|JOANN,JO ANN FABRIC|homeware
Mercari|MERCARI|marketplace
Poshmark|POSHMARK|marketplace
OfferUp|OFFERUP|marketplace
Venmo|VENMO|payments
Cash App|CASH APP,SQUARE CASH|payments
Affirm|AFFIRM|payments
Toast|TOAST INC,TOASTTAB|payments
Clover|CLOVER|payments
Zelle|ZELLE|transfer
MoneyGram|MONEYGRAM|transfer
Xoom|XOOM|transfer
Gemini|GEMINI TRUST,GEMINI|crypto
Crypto.com|CRYPTO COM|crypto
Robinhood|ROBINHOOD|investment
Charles Schwab|SCHWAB,CHARLES SCHWAB|investment
Fidelity Investments|FIDELITY INVESTMENTS,FIDELITY BROKERAGE|investment
Vanguard|VANGUARD|investment
E*TRADE|ETRADE,E TRADE|investment
Interactive Brokers|INTERACTIVE BROKERS|investment
Webull|WEBULL|investment
Acorns|ACORNS|investment
Betterment|BETTERMENT|investment
Wealthfront|WEALTHFRONT|investment
Hulu|HULU|streaming
Max|HBO MAX,MAX COM|streaming
Peacock|PEACOCK|streaming
YouTube TV|YOUTUBE TV|streaming
Sling TV|SLING TV|streaming
SiriusXM|SIRIUSXM,SIRIUS XM|streaming
Pandora Music|PANDORA MEDIA,PANDORA MUSIC|streaming
Peloton|PELOTON|streaming
Wall Street Journal|WALL STREET JOURNAL,WSJ,DOW JONES|news
Washington Post|WASHINGTON POST|news
Bloomberg|BLOOMBERG|news
Planet Fitness|PLANET FITNESS|gym
LA Fitness|LA FITNESS|gym
24 Hour Fitness|TWENTY FOUR HOUR FITNESS|gym
Anytime Fitness|ANYTIME FITNESS|gym
Equinox|EQUINOX|gym
Gold's Gym|GOLDS GYM|gym
Crunch Fitness|CRUNCH FITNESS|gym
Orangetheory|ORANGETHEORY|gym
Life Time|LIFE TIME FITNESS,LIFETIME FITNESS|gym
YMCA|YMCA|gym
AMC Theatres|AMC THEATRES,AMC|entertainment
Regal Cinemas|REGAL CINEMAS,REGAL|entertainment
Cinemark|CINEMARK|entertainment
Ticketmaster|TICKETMASTER|entertainment
StubHub|STUBHUB|entertainment
SeatGeek|SEATGEEK|entertainment
American Red Cross|AMERICAN RED CROSS,RED CROSS|charity
The Salvation Army|SALVATION ARMY|charity
Goodwill Industries|GOODWILL INDUSTRIES,GOODWILL STORE|charity
United Way|UNITED WAY|charity
St. Jude|ST JUDE|charity
Habitat for Humanity|HABITAT FOR HUMANITY|charity
Feeding America|FEEDING AMERICA|charity
ASPCA|ASPCA|charity
UNICEF|UNICEF|charity
AICPA|AICPA|professional
ChargePoint|CHARGEPOINT|evCharging
Electrify America|ELECTRIFY AMERICA|evCharging
EVgo|EVGO|evCharging
Blink Charging|BLINK CHARGING|evCharging
Tractor Supply|TRACTOR SUPPLY|farm
Rural King|RURAL KING|farm
John Deere|JOHN DEERE|farm
`;
