# The Mattioli’s Hub · Il nostro punto di incontro

Portale privato della famiglia Mattioli: un punto di incontro e condivisione di link, risorse e passioni. Identità aggiornata il 23 ottobre 2026.

## Cosa è pronto

- Interfaccia responsive coerente con il mockup: navigazione blu notte, sfondo chiaro e dettagli petrolio.
- Ricerca su titolo, descrizione, URL e categoria. Scorciatoia Ctrl/Cmd K.
- Link e categorie condivisi fra tutti gli utenti autorizzati, preferiti personali.
- Area amministrazione: creazione, modifica, eliminazione e ordinamento numerico di link e categorie; creazione utenti, ruoli, disattivazione e inviti di attivazione.
- Accesso con email/password, logout, cambio password e recupero via email.
- Database D1, API Worker e risorse statiche, tutto nello stesso progetto Cloudflare.
- Esportazione JSON di link e categorie. L’esportazione non include utenti, password o sessioni e non è un backup completo del database.

L’HTML `Punto_Anteprima.html` è un’anteprima autonoma con dati di esempio. Non richiede installazione né account; aprilo in un browser. Le modifiche dimostrative si perdono alla ricarica. Il progetto vero usa solo le API e D1: non salva credenziali o link privati nel browser. L’anteprima non verifica il funzionamento del backend Cloudflare.

## Stato di consegna

Progetto implementato e testato localmente, non ancora pubblicato. Non sono stati creati account Cloudflare né collegati servizi email. Il controllo visivo nel browser di verifica non è stato completato: l’accesso all’anteprima è stato bloccato dalla policy del browser. Nessuna credenziale reale è presente nel pacchetto. Prima dell’uso effettivo servono la configurazione sotto e una verifica sul runtime Workers, incluso il recupero email end-to-end.

## Progetti indipendenti

Usa per questo progetto un Worker `punto-hub`, un database `mattiolis_hub_db` e le sue variabili/segreti. Non riutilizzare nomi, database o token dell’altro progetto. Le quote gratuite per account restano condivise: non c’è isolamento delle quote o della fatturazione. Non è presente alcun meccanismo di sospensione per inattività implementato dall’app. Le condizioni e le quote dei provider possono cambiare; non si può garantire gratuità perpetua.

## Percorso consigliato: GitHub → Cloudflare

Il codice va nella radice del repository `dermatoid-collab/THE_MATTIOLIS_HUB`, non in una sottocartella. Le modifiche a link e utenti si fanno dal sito; GitHub serve per aggiornare il software.

### Prima configurazione, dal pannello Cloudflare

1. Il database dedicato `mattiolis_hub_db` è già stato creato. Il suo ID `8ff12924-77ff-4af1-87e9-d09f6aa089f3` è configurato in `wrangler.jsonc` con binding `DB`. L’associazione è preparata nel codice; lo schema va ancora inizializzato sul database Cloudflare.
2. Nel pannello del nuovo database apri **Console** ed esegui lo SQL di `migrations/0001_initial.sql` dal repository, una sola volta su questo database vuoto. In alternativa puoi usare il comando Wrangler documentato sotto. La console e il comando sono percorsi alternativi: non eseguire entrambi senza registrare la migrazione come applicata.
3. In **Workers & Pages → Create application → GitHub** autorizza Cloudflare ad accedere a questo repository e selezionalo. Il Worker deve chiamarsi **`punto-hub`**, come `name` in `wrangler.jsonc`. Se il nome non è disponibile, aggiorna entrambi prima del deploy.
4. Imposta ramo di produzione **`main`**, directory radice **`/`**, comando di build **`npm test`**, comando di deploy **`npx wrangler deploy`**. Non abilitare ancora le anteprime dei rami: la configurazione non prevede database di prova separati.
5. Il primo deploy distribuisce solo codice e schema di accesso; le mutazioni restano bloccate finché `APP_ORIGIN` contiene il segnaposto. Copia l’indirizzo HTTPS effettivo del Worker e inseriscilo in `APP_ORIGIN` dentro `wrangler.jsonc`, senza slash finale, poi salva il commit. Il nuovo commit attiva un deploy aggiornato.
6. Nelle impostazioni del Worker, **Variables and Secrets**, aggiungi `BOOTSTRAP_TOKEN` come **Secret**, usando un codice casuale lungo creato e conservato da te. Puoi generarlo con un password manager. Non inserirlo in GitHub, nei comandi o in chat. Applica/pubblica la nuova configurazione. Il segreto appartiene al Worker di produzione, non soltanto all’ambiente di build.
7. Apri l’hub e crea il primo amministratore con quel codice, il tuo nome, email e una password non vuota, senza requisiti di lunghezza o composizione. Dopo l’attivazione elimina `BOOTSTRAP_TOKEN` dal Worker e applica la configurazione.
8. Configura separatamente il servizio email per il recupero password, come spiegato sotto. Fino ad allora l’hub segnala che il recupero via email non è disponibile.

Lo schema SQL caricato dalla Console non crea automaticamente il registro delle migrazioni Wrangler. Per aggiornamenti futuri usa nuove migrazioni con un percorso coerente e non riapplicare la prima a un database esistente. Prima di aggiornare lo schema esegui un backup.

GitHub esegue i test tramite `.github/workflows/checks.yml`. Cloudflare ripete `npm test` prima del deploy, così una suite fallita interrompe la pubblicazione. La prima configurazione di database e segreti rimane necessaria: collegare il repository non li crea automaticamente.

Nessun dato degli utenti viene salvato nel repository. Il repository può essere privato; la privacy del codice è distinta dalla protezione degli accessi all’hub. Non caricare mai `.dev.vars`, backup SQL o chiavi API.

## Pubblicazione su Cloudflare

Questi comandi si eseguono dalla cartella `punto`. Richiedono Node.js LTS e npm. Per sviluppo e test locali con lo script incluso usa Node 24 o successivo (SQLite integrato). Non caricare questo ZIP come semplice sito statico: l’accesso reale richiede il Worker e D1.

1. Crea il tuo account su https://dash.cloudflare.com/ . Non inserire password o token in chat.
2. Nella cartella del progetto installa il CLI ufficiale e autentica il tuo account:

   ```sh
   npm install --save-dev wrangler@4
   npx wrangler login
   npx wrangler d1 create mattiolis_hub_db
   ```

3. Copia il `database_id` restituito in `wrangler.jsonc`, lasciando il binding `DB` e il nome `mattiolis_hub_db`. Se esiste già un database con questo nome, scegli un nome nuovo per questo progetto e aggiorna la configurazione. Non utilizzare quello dell’altro progetto.
4. In `wrangler.jsonc` inserisci in `APP_ORIGIN` l’indirizzo HTTPS definitivo del Worker, ad esempio `https://punto-hub.TUO-SOTTODOMINIO.workers.dev`, senza slash finale. Il sottodominio si vede nel pannello Workers & Pages. L’app richiede che l’origine della richiesta coincida esattamente con questo valore.
5. Applica lo schema e le categorie iniziali al nuovo database:

   ```sh
   npx wrangler d1 migrations apply mattiolis_hub_db --remote
   ```

6. Genera un codice casuale per l’inizializzazione, ad esempio con il comando seguente. Conservalo privatamente: non è una password utente, ma abilita la creazione del primo amministratore. Non inserirlo nel codice o nel repository.

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx wrangler secret put BOOTSTRAP_TOKEN
   ```

   Wrangler chiede il valore in modo interattivo: incolla il codice nel prompt, non come argomento del comando. Crea il Worker con `npx wrangler deploy` prima del secret se il CLI richiede che esista già.

7. Pubblica:

   ```sh
   npx wrangler deploy
   ```

8. Apri il sito: se non ci sono utenti, compare la configurazione iniziale. Inserisci il codice, il tuo nome, l’email e una password non vuota, senza requisiti di lunghezza o composizione. La creazione del primo utente è atomica; non esiste un account predefinito. Non usare l’anteprima per questo passaggio.
9. Dopo aver creato il tuo amministratore, elimina il codice di bootstrap:

   ```sh
   npx wrangler secret delete BOOTSTRAP_TOKEN
   ```

10. Aggiungi i tuoi link. Nell’area Utenti crea le persone che vuoi autorizzare e copia il loro link di attivazione. Condividilo privatamente: è un segreto temporaneo che consente di impostare la password. Nessuna email di invito viene spedita automaticamente.

Se cambi dominio, aggiorna `APP_ORIGIN`, ripubblica e rigenera eventuali inviti. Non attivare URL di anteprima alternativi per l’uso degli utenti senza configurare una propria origine.

## Recupero password: attivare le email

Il codice include un adattatore per Resend, ma non dipende da un account già creato. Non è stato selezionato o acquistato alcun piano. Per uso reale occorre verificare condizioni correnti, quote e requisiti del servizio scelto. L’adattatore può essere sostituito con un altro provider.

1. Crea/configura il servizio email; verifica un dominio mittente che possiedi e aggiungi i record DNS richiesti dal provider. Il sottodominio gratuito `workers.dev` non è un dominio di posta di tua proprietà. L’eventuale acquisto/rinnovo di un dominio è un costo distinto dall’hosting.
2. Imposta `MAIL_FROM` in `wrangler.jsonc`, per esempio `The Mattioli’s Hub <accesso@tuodominio.it>`.
3. Aggiungi la chiave API come segreto, in modo interattivo:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler deploy
   ```

4. Testa il flusso con una tua casella reale: richiesta, arrivo email, link, nuova password e chiusura delle sessioni precedenti. Non sono state inviate email durante la preparazione.

Senza configurazione il recupero mostra esplicitamente che il servizio non è attivo: non simula invii riusciti. Con configurazione attiva la risposta è generica anche per indirizzi sconosciuti o per un errore del provider, per non rivelare quali account esistano. Se un messaggio non arriva, va controllato il pannello del provider e poi ripetuta la richiesta, rispettando il limite di frequenza.

## Policy di accesso

- Registrazione pubblica disattivata. Ruoli: `admin` e `user`.
- Password non vuote, senza requisiti di lunghezza o composizione; vengono salvati hash PBKDF2 SHA-256 con sale casuale e 100.000 iterazioni, compatibili con Web Crypto Workers. Mai password in chiaro nel database. Questo parametro va rivalutato con i limiti del runtime e con l’evoluzione delle raccomandazioni; per requisiti più elevati è preferibile un servizio di identità dedicato o un KDF più oneroso su un runtime adeguato.
- Sessioni di 12 ore, cookie HttpOnly, Secure e SameSite=Strict in produzione, token casuali memorizzati nel database soltanto come hash.
- Link di recupero validi 30 minuti; link di attivazione validi 24 ore. Tutti monouso. Queste scadenze proteggono le credenziali e non sono scadenze dell’hosting.
- Cambio password e recupero chiudono tutte le sessioni dell’utente e invalidano gli altri token.
- Modifiche del ruolo/stato chiudono le sessioni; un utente disattivato non può accedere né usare inviti pendenti.
- È impossibile disattivare o declassare l’ultimo amministratore attivo, anche via API.
- Controllo dell’origine sulle richieste che modificano dati, autorizzazione server su tutte le API private e limitazione dei tentativi di accesso/recupero.
- Nessun tracker, font remoto, caricamento automatico di favicon esterne o anteprima dei siti salvati. I link vengono visitati soltanto quando l’utente li apre.
- Il portale protegge la raccolta dei link; non può proteggere i siti di destinazione, che mantengono i propri accessi e permessi.

## Test locali e verifica prima dell’apertura

```sh
npm test
```

La suite usa lo stesso Worker e lo schema SQL con un adattatore SQLite locale, non il runtime D1/Workers reale. Copre bootstrap, cookie, blocco accessi anonimi, controllo origine, login/logout, ruoli, link CRUD, URL pericolosi, preferiti, categorie eliminate, ultimo admin, inviti monouso, disattivazione, cambio password, scadenza reset, email simulate e limiti tentativi. Per una prova nel runtime locale ufficiale, dopo aver installato Wrangler:

```sh
npx wrangler d1 migrations apply mattiolis_hub_db --local
npx wrangler dev
```

Per questa prova usa un file locale `.dev.vars` (ignorato da Git) con `APP_ORIGIN="http://localhost:8787"`, `LOCAL_DEV="true"` e un `BOOTSTRAP_TOKEN` casuale, destinato solo ai dati di prova. I cookie di sviluppo non sono Secure. Non impostare mai `LOCAL_DEV` nel deployment pubblico. Per la produzione è obbligatorio HTTPS.

Un server Node alternativo è incluso per l’anteprima UI con `npm run dev`; usa SQLite in `.local/` e nessuna email. Non è il server di produzione. La URL `/?demo=1` attiva solo l’anteprima, anche sul sito distribuito: non dà accesso ai dati reali.

Dopo il deploy, prima di invitare altre persone, verifica: creazione del primo admin; aggiunta/modifica/eliminazione link e categorie; persistenza dopo logout e da un altro dispositivo; utente normale senza permessi admin; disattivazione; recupero email completo; layout desktop e smartphone; consumi CPU delle operazioni password sul piano Workers scelto. I test locali non certificano compatibilità né prestazioni in produzione.

## Backup e aggiornamenti

Per esportare i soli link usa il pulsante Esporta nell’area admin. Per un backup completo, che include anche dati sensibili degli account, esegui separatamente `npx wrangler d1 export mattiolis_hub_db --remote --output backup.sql` e proteggi il file come una credenziale: contiene hash password e token/sessioni attivi. Non pubblicarlo e non includerlo nel repository. D1 offre anche Time Travel con conservazione limitata, non un backup eterno. La funzione di importazione link non è inclusa in questa versione.

Gli aggiornamenti dei link e degli utenti si eseguono dal sito. Per aggiornare il codice serve ridistribuire il Worker; per modifiche allo schema SQL si aggiungono nuove migrazioni, senza sovrascrivere la prima su un database già in uso. La normale gestione non richiede il computer di sviluppo sempre acceso.

## Riferimenti ufficiali

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://resend.com/docs/api-reference/emails/send-email

## Identità di famiglia

Nome pubblico: **The Mattioli’s Hub**. Messaggio principale: **Il nostro punto di incontro.** La raccolta dei link è condivisa; ogni familiare mantiene i propri preferiti. I nomi tecnici `punto-hub`, `mattiolis_hub_db` e dei file rimangono invariati per mantenere coerenti i passaggi di configurazione già forniti. Non sono state aggiunte funzioni di chat, calendario o condivisione file.

Categorie iniziali approvate: **Scienza, Viaggi, Casa**, in questo ordine. Modificabili dall’area admin. Nell’anteprima i siti sono esempi; il database di produzione parte senza link.

## Lista della spesa condivisa

La sezione “Lista della spesa” è disponibile a tutti gli utenti attivi, non solo agli amministratori. Ogni lista ha titolo, colore e prodotti con quantità facoltative. Tutti i familiari possono creare, modificare e spuntare i prodotti; le indicazioni “Aggiunto da” e “Spuntato da” mostrano il nome del familiare.

- Vista a schede e filtri Tutte, Da completare, Completate e Archivio.
- Inserimento rapido con Invio; riordino manuale dei prodotti da acquistare tramite frecce.
- Prodotti acquistati raccolti in una sezione richiudibile.
- Archiviazione e ripristino delle liste senza cancellazione dei prodotti.
- “Riutilizza lista” toglie le spunte ai prodotti esistenti; non ripristina quelli rimossi.
- La rimozione di un prodotto è logica e può essere annullata dall’avviso in pagina. Non è presente una cancellazione fisica dei prodotti via API.
- Sincronizzazione ogni 12 secondi mentre la sezione è aperta e visibile. Il polling viene sospeso durante la compilazione di una voce non vuota o con un dialogo aperto; le bozze di inserimento vengono mantenute in memoria. Non c’è una modalità offline con accodamento: in assenza di connessione un’operazione fallisce e viene segnalata.
- Le modifiche ai prodotti e alle proprietà delle liste usano versioni ottimistiche: una modifica basata su dati superati riceve HTTP 409, senza sovrascrivere la modifica del familiare.

### Aggiornamento del database esistente

Non è necessario eseguire nuovamente `0001_initial.sql`. Lo schema shopping viene creato automaticamente alla prima richiesta autenticata a `/api/shopping`, tramite `CREATE TABLE/INDEX IF NOT EXISTS`, in un batch D1. L’inizializzazione aggiunge solo `shopping_lists`, `shopping_items` e i loro indici: non modifica le tabelle o i record precedenti. Le richieste anonime vengono respinte prima di poter inizializzare lo schema.

Il file `migrations/0002_shopping.sql` contiene lo stesso schema additivo, applicabile anche dal normale percorso di migrazioni su una configurazione che lo utilizza già. È idempotente. Nessuna lista dimostrativa viene inserita in produzione. Le liste d’esempio esistono soltanto nell’anteprima `?demo=1`.

I test shopping verificano accessi, inizializzazione idempotente, uso condiviso da utenti normali, quantità, aggiunte concorrenti, conflitti, spunte, rimozione e ripristino, archivio, riutilizzo e riordino. I test restano locali con SQLite; il dry-run Wrangler verifica il bundle del Worker, non il database Cloudflare remoto.

### Notifiche personali (push Android/PC ed email)
La campanella e **Il mio account → Gestisci preferenze notifiche** consentono di scegliere canali, link/categorie, spesa e nuove versioni, ed escludere le proprie modifiche. I canali esterni sono disattivati per impostazione iniziale. Lo storico conserva 30 giorni; gli invii non vengono ricreati retroattivamente dopo l'attivazione.

Per le push, ogni utente preme **Attiva su questo dispositivo**, consente il permesso del browser e può inviare una prova. Le chiavi VAPID vengono generate nel Worker e conservate in D1; solo la chiave pubblica raggiunge il browser. Rimuovendo un dispositivo o uscendo dall'account si scollega quel browser; gli altri dispositivi restano collegati. Browser e sistema operativo possono sospendere la ricezione. Nessun servizio a pagamento aggiuntivo è richiesto dal codice push.

Per l'email configurare in Cloudflare **Settings → Runtime variables and secrets** il secret `RESEND_API_KEY` e `MAIL_FROM` con un mittente verificato presso Resend. Sostituire anche il valore predefinito `MAIL_FROM` in `wrangler.jsonc` per i deploy successivi. Non inserire la chiave nel repository. Il pulsante **Prova email** invia solo all'indirizzo dell'utente autenticato. Senza configurazione la preferenza resta salvata, ma l'interfaccia segnala che l'invio non è attivo. Limiti e costi dipendono dal piano del provider email.

La migrazione `0003_notifications.sql` è additiva e viene applicata automaticamente alla prima richiesta autenticata o dal cron. Il cron Cloudflare ogni minuto registra una sola notifica per versione (`CF_VERSION_METADATA`) e svuota la coda; le modifiche condivise attivano anche un invio in background immediato. Sono previsti massimo 5 tentativi, attese crescenti e scarto dopo 7 giorni. Gli endpoint scaduti (404/410) vengono rimossi. Il servizio conserva gli eventi anche in caso di errore del provider; l'accettazione da parte del provider non garantisce la ricezione. Non vengono notificati accessi, password, preferiti personali o gestione degli account.

Controlli: `npm ci`, `npm test`, `npx wrangler deploy --dry-run`. I test simulano i provider e non spediscono notifiche reali.
