#!/usr/bin/env nbb
;; resource-provider — executable specification, in the counted plane.
;;
;; This repo's stated reason to exist is one boundary: what the substrate may
;; read in plaintext, versus what it may only ever hold as ciphertext. Nothing
;; was asserting that boundary. The TypeScript suite next door tests the
;; operations, but it cannot run here at all -- its two dependencies are git
;; URLs whose install needs package prepare scripts, which npm refuses in a
;; project-scoped install (measured 2026-09-01, EALLOWSCRIPTS). A suite that
;; cannot be installed and a suite that passes are the same colour from outside.
;;
;; So this suite takes no dependencies. It loads the REAL src/registry.ts and
;; src/types.ts under node's native type stripping and drives all 17 exported
;; operations against an in-memory substrate that records which SDK method each
;; write went through. The only rewrite is the module specifier: TypeScript
;; source says `from "./types.js"`, which node resolves literally and does not
;; find. Nothing else about the source is touched, and the rewrite is asserted
;; to be the only relative import in the file.
;;
;;   nbb test/resource_provider_test.cljs
;;
;; exit 0 = all checks passed, 1 = a check failed, 2 = REFUSED (could not
;; measure). 2 is not 1: "I could not run the checks" must not be reportable as
;; "the checks found nothing".

(ns resource-provider-test
  (:require [clojure.string :as str]
            [promesa.core :as p]
            ["fs" :as fs]
            ["os" :as os]
            ["path" :as path]))

;; ── tiny harness ────────────────────────────────────────────────────

(def failures (atom []))
(def checks (atom 0))

(defn check! [nm ok? detail]
  (swap! checks inc)
  (when-not ok?
    (swap! failures conj nm)
    (println (str "FAIL " nm))
    (println (str "     " detail))))

(defn refuse! [why]
  (println (str "REFUSED " why))
  (println "Refusing to report a pass on checks that did not run.")
  (js/process.exit 2))

;; ── load the real TypeScript ────────────────────────────────────────

;; The suite lives at the repo's top-level test/ ; the package it tests is under
;; kotoba/ . Accept either as the working directory rather than depending on one.
(def pkg-dir
  (first (filter #(fs/existsSync (path/join % "src" "types.ts"))
                 [(path/resolve "kotoba") (path/resolve ".")])))

(when-not pkg-dir
  (refuse! (str "no src/types.ts under " (path/resolve "kotoba") " or " (path/resolve ".")
                " -- run this from the repo root")))

(def src-dir (path/join pkg-dir "src"))
(def types-path (path/join src-dir "types.ts"))
(def registry-path (path/join src-dir "registry.ts"))

(when-not (fs/existsSync registry-path)
  (refuse! (str "expected " registry-path)))

(def types-src (fs/readFileSync types-path "utf8"))
(def registry-src (fs/readFileSync registry-path "utf8"))

(def types-url (str "file://" types-path))
(def registry-rewritten (str/replace registry-src "\"./types.js\"" (str "\"" types-url "\"")))

;; The rewrite must be exactly one specifier. If a future edit adds another
;; relative import, this suite would silently be testing a module that failed to
;; resolve part of itself -- so refuse rather than guess.
(when (= registry-rewritten registry-src)
  (refuse! "registry.ts no longer imports \"./types.js\"; the loader shim is stale"))
(let [others (->> (re-seq #"from \"\./[^\"]+\"" registry-rewritten) distinct vec)]
  (when (seq others)
    (refuse! (str "registry.ts has relative imports this loader does not rewrite: "
                  (pr-str others)))))

(def tmp-registry (path/join (os/tmpdir) (str "resource-provider-registry-" (js/Date.now) ".ts")))
(fs/writeFileSync tmp-registry registry-rewritten)

;; ── the boundary this repo exists to enforce ────────────────────────
;;
;; Left set: the substrate sees the record. Right set: the substrate sees
;; ciphertext only. Every collection/inner-type declared in types.ts must appear
;; in exactly one of these, or the completeness check below fails.

(def plaintext-collections
  #{"com.etzhayyim.apps.resourceProvider.resourceListing"
    "com.etzhayyim.apps.resourceProvider.contributionStat"})

(def sealed-inner-types
  #{"com.etzhayyim.apps.resourceProvider.providerProfile"
    "com.etzhayyim.apps.resourceProvider.contributionEntry"
    "com.etzhayyim.apps.resourceProvider.rewardLedgerEntry"
    "com.etzhayyim.apps.resourceProvider.rewardBalance"})

;; ── in-memory substrate ─────────────────────────────────────────────
;;
;; Records what each operation actually did, so the boundary can be asserted
;; from behaviour rather than from reading the source.

(defn make-substrate [] (atom {:plain [] :sealed [] :calls []}))

(defn actor
  "A view of the shared substrate as a given DID. Read-cap on the sealed path is
   owner + explicit recipients (ADR-2605181100), so an outsider constructed here
   sees the plaintext catalog and none of the sealed bodies."
  [store did]
  (letfn [(note! [m k] (swap! store update :calls conj {:method m :target k}))]
    #js
    {:did did
     :write
     (fn [opts]
       (let [o (js->clj opts :keywordize-keys true)
             coll (:collection o)
             rkey (:rkey o)
             uri (str "at://" did "/" coll "/" rkey)]
         (note! :write coll)
         (swap! store update :plain
                (fn [rs] (conj (vec (remove #(and (= coll (:collection %)) (= rkey (:rkey %))) rs))
                               {:collection coll :rkey rkey :uri uri :value (aget opts "record")})))
         (js/Promise.resolve #js {:uri uri})))
     :read
     (fn [opts]
       (let [o (js->clj opts :keywordize-keys true)
             coll (:collection o)
             rkey (:rkey o)
             _ (note! :read coll)
             rs (->> (:plain @store)
                     (filter #(= coll (:collection %)))
                     (filter #(or (nil? rkey) (= rkey (:rkey %)))))]
         (js/Promise.resolve
          #js {:records (clj->js (mapv (fn [r] {:uri (:uri r) :value (:value r)}) rs))
               :cursor nil})))
     :encryptedWrite
     (fn [opts]
       (let [o (js->clj opts :keywordize-keys true)
             it (:innerType o)
             rkey (:rkey o)
             uri (str "at://" did "/encrypted/" rkey)]
         (note! :encryptedWrite it)
         (swap! store update :sealed
                (fn [rs] (conj (vec (remove #(and (= it (:innerType %)) (= rkey (:rkey %))) rs))
                               {:innerType it :rkey rkey :uri uri :owner did
                                :recipients (vec (:recipients o))
                                :createdAt "2026-01-01T00:00:00.000Z"
                                :value (aget opts "record")})))
         (js/Promise.resolve #js {:uri uri :keyId (str "key-" rkey)})))
     :encryptedRead
     (fn [opts]
       (let [o (js->clj opts :keywordize-keys true)
             it (:innerType o)
             _ (note! :encryptedRead it)
             rs (->> (:sealed @store)
                     (filter #(= it (:innerType %)))
                     (filter #(or (= did (:owner %)) (some #{did} (:recipients %)))))]
         (js/Promise.resolve
          #js {:records (clj->js (mapv (fn [r] {:uri (:uri r) :value (:value r)
                                                :sender (:owner r) :createdAt (:createdAt r)}) rs))
               :cursor nil})))}))

(def OWNER "did:web:resource-provider.etzhayyim.com")

;; ── A. the plaintext / sealed boundary, observed ────────────────────

(def GEO "37.7749,-122.4194")
(def FINGERPRINT "fp-serial-8891-ACME")
(def PAYLOAD "bafyreiexamplecontributionpayloadref")
(def AMOUNT "12.50")
(def BALANCE "15.50")

(defn check-boundary! [R]
  (let [store (make-substrate)
        e (actor store OWNER)
        partner "did:web:trainer.example"]
    (p/let
     [_ (.registerListing R e #js {:listingId "l1" :resourceType "gpu"
                                   :region "us-west" :capacity 120})
      _ (.recordStat R e #js {:statId "s1" :listingId "l1" :resourceType "gpu"
                              :contributionCount 10 :acceptedUnits 8})
      _ (.upsertProfile R e #js {:profileId "pr1" :providerDid "did:web:alice"
                                 :displayName "Alice" :geo GEO
                                 :deviceFingerprint FINGERPRINT :contact "alice@example"})
      _ (.submitContribution R e #js {:entryId "ce1" :providerDid "did:web:alice"
                                      :listingId "l1" :resourceType "data"
                                      :payloadRef PAYLOAD :qualityScore 92})
      _ (.postLedger R e #js {:ledgerId "rl1" :providerDid "did:web:alice"
                              :entryId "ce1" :amount AMOUNT :currency "USDC"})
      _ (.setBalance R e #js {:balanceId "b1" :providerDid "did:web:alice"
                              :balance BALANCE :currency "USDC"})
      _ (let [written (->> (:calls @store) (filter #(= :write (:method %))) (map :target) set)]
          (check! "boundary-plaintext-writes-only-the-public-catalog"
                  (= written plaintext-collections)
                  (str "sdk.write reached " (pr-str written)
                       ", expected exactly the two public collections")))
      _ (let [sealed-w (->> (:calls @store) (filter #(= :encryptedWrite (:method %)))
                            (map :target) set)]
          (check! "boundary-every-sealed-type-goes-through-encryptedWrite"
                  (= sealed-w sealed-inner-types)
                  (str "sdk.encryptedWrite reached " (pr-str sealed-w)
                       ", expected all four sealed inner types")))
      ;; The substrate holds plaintext records verbatim. No PII, no payload
      ;; reference and no money may appear anywhere in them.
      _ (let [plain-json (js/JSON.stringify (clj->js (mapv :value (:plain @store))))]
          (doseq [[label secret] [["geo" GEO] ["device-fingerprint" FINGERPRINT]
                                  ["payload-ref" PAYLOAD] ["reward-amount" AMOUNT]
                                  ["reward-balance" BALANCE]]]
            (check! (str "boundary-plaintext-never-contains-" label)
                    (not (str/includes? plain-json secret))
                    (str "found " (pr-str secret) " in the plaintext substrate: " plain-json))))
      ;; Read-cap: a fresh DID that is neither owner nor recipient.
      outsider (actor store "did:web:outsider.example")
      op (.listProfiles R outsider)
      oc (.listContributions R outsider)
      ol (.listLedger R outsider)
      oi (.listListings R outsider)
      ;; The owner must still see the record at the same moment the outsider
      ;; does not. Without this pair, "outsider sees zero" is also satisfied by
      ;; the record being ABSENT -- which is exactly what happens if a sealed
      ;; write is swapped for a plaintext one, since scanProfiles reads via
      ;; encryptedRead and finds nothing. The repo's own quickstart names this
      ;; as the weakness of the TypeScript suite's read-cap test.
      ownp (.listProfiles R e)
      _ (check! "read-cap-owner-still-sees-the-record-the-outsider-cannot"
                (= 1 (.-total ownp))
                (str "the owner reads " (.-total ownp) " profiles; an outsider "
                     "seeing zero then proves absence, not access control"))
      _ (do (check! "read-cap-outsider-sees-no-profiles" (= 0 (.-total op))
                    "an outsider read provider PII")
            (check! "read-cap-outsider-sees-no-contributions" (= 0 (.-total oc))
                    "an outsider read contributed content")
            (check! "read-cap-outsider-sees-no-ledger" (= 0 (.-total ol))
                    "an outsider read the reward ledger")
            (check! "read-cap-outsider-still-sees-the-public-catalog" (= 1 (.-total oi))
                    "the public marketplace catalog is meant to be public"))
      ;; An explicit recipient is granted read-cap.
      _ (.upsertProfile R e #js {:profileId "pr2" :providerDid "did:web:bob"
                                 :displayName "Bob" :geo "1,2"
                                 :deviceFingerprint "fp2" :contact "c"
                                 :recipients #js [partner]})
      pp (.listProfiles R (actor store partner))]
      (check! "read-cap-explicit-recipient-sees-exactly-that-record"
              (= 1 (.-total pp))
              "an explicit recipient could not read the record sealed for them"))))

;; ── B. record identity: distinct ids must stay distinct ─────────────
;;
;; rkey is where the record lives; the DID is what the record calls itself. If
;; two ids share an rkey but not a DID, the second registration is told
;; "alreadyExists" and handed the FIRST provider's DID and URI.

(defn check-identity! [T R]
  (let [ids ["gpu.west" "gpu_west" "gpu-west" "gpu~west"]
        rkeys (mapv #(.rkeyOf T "listing" %) ids)
        dids (mapv #(.listingDidFor T %) ids)]
    (check! "record-key-derivation-is-injective"
            (= (count (set rkeys)) (count ids))
            (str "distinct listingIds collapse to the same record key: "
                 (pr-str (zipmap ids rkeys))))
    (check! "record-key-and-did-agree-on-identity"
            (= (count (set rkeys)) (count (set dids)))
            (str "ids that share a record key must share a DID; got rkeys "
                 (pr-str (set rkeys)) " but DIDs " (pr-str (set dids)))))
  ;; listingDidFor is internal: callers validate first. So the contract is an
  ;; implication -- every id the validator ACCEPTS must derive a well-formed
  ;; DID -- plus the guarantee that ids it rejects never reach an operation
  ;; (asserted below as unrepresentable-listing-id-is-rejected). The floor
  ;; matters: if isSafeId started rejecting everything, an implication over an
  ;; empty set would pass while the repo was entirely broken.
  (let [candidates ["gpu.west" "gpu_west" "gpu-west" "gpu~west" "GPU.West" "l1"
                    "gpu west" "gpu/west" "gpu:west" "gpu\"west" "" "gpu#west"]
        accepted (filterv #(.isSafeId T %) candidates)
        rejected (filterv #(not (.isSafeId T %)) candidates)]
    (check! "id-validator-accepts-and-rejects-something"
            (and (<= 6 (count accepted)) (<= 6 (count rejected)))
            (str "isSafeId partitioned " (pr-str candidates) " into accepted="
                 (pr-str accepted) " rejected=" (pr-str rejected)
                 " -- a validator that answers one way for everything decides nothing"))
    (check! "did-is-well-formed-for-every-accepted-id"
            (every? #(re-matches #"[A-Za-z0-9.:_~-]+" (.listingDidFor T %)) accepted)
            (str "these accepted ids derive a malformed DID: "
                 (pr-str (remove #(re-matches #"[A-Za-z0-9.:_~-]+" (.listingDidFor T %))
                                 accepted))))
    (check! "id-validator-rejects-a-space"
            (not (.isSafeId T "gpu west"))
            "isSafeId accepted an id containing a space"))
  (let [s1 (make-substrate) e1 (actor s1 OWNER)
        s2 (make-substrate) e2 (actor s2 OWNER)]
    (p/let
     [;; An id that cannot be represented as a record key must be refused, not
      ;; silently folded onto some other provider's key.
      unsafe (.registerListing R e1 #js {:listingId "gpu west" :resourceType "gpu"
                                         :region "us-west" :capacity 10})
      _ (check! "unrepresentable-listing-id-is-rejected"
                (= "rejected" (.-status unsafe))
                (str "registerListing accepted an id containing a space: "
                     (js/JSON.stringify unsafe)))
      ;; The foreign key the README advertises.
      _ (.registerListing R e2 #js {:listingId "gpu.west" :resourceType "gpu"
                                    :region "us-west" :capacity 120})
      dangling (.recordStat R e2 #js {:statId "s1" :listingId "gpu_west"
                                      :resourceType "gpu" :contributionCount 1
                                      :acceptedUnits 1})
      _ (check! "foreign-key-rejects-a-listing-that-was-never-registered"
                (= "rejected" (.-status dangling))
                (str "recordStat accepted listingId \"gpu_west\" when only \"gpu.west\" "
                     "was registered: " (js/JSON.stringify dangling)))
      real (.recordStat R e2 #js {:statId "s2" :listingId "gpu.west"
                                  :resourceType "gpu" :contributionCount 1
                                  :acceptedUnits 1})]
      (check! "foreign-key-still-admits-the-listing-that-does-exist"
              (= "recorded" (.-status real))
              (str "recordStat rejected a listing that was registered: "
                   (js/JSON.stringify real))))))

;; ── C. validators, on the real functions ────────────────────────────

(defn check-validators! [T]
  (doseq [[in expected] [["12.50" true] ["0" true] ["-3.5" true] ["007" true]
                         ["" false] ["abc" false] ["1." false] [".5" false]
                         ["1.2.3" false] ["1e3" false] [" 1" false] ["1 " false]
                         ["١٢" false] [12.5 false] [nil false]]]
    (check! (str "isDecimalString-" (pr-str in))
            (= expected (.isDecimalString T in))
            (str "isDecimalString(" (pr-str in) ") = " (.isDecimalString T in)
                 ", expected " expected)))
  (doseq [[in expected] [[0 true] [100 true] [50 true] [-1 false] [101 false]
                         [1.5 false] ["50" false] [nil false]]]
    (check! (str "isPct-" (pr-str in))
            (= expected (.isPct T in))
            (str "isPct(" (pr-str in) ") = " (.isPct T in) ", expected " expected)))
  (doseq [[in expected] [[0 true] [1 true] [-1 false] [1.5 false] ["1" false]
                         [##Inf false] [nil false]]]
    (check! (str "isUint-" (pr-str in))
            (= expected (.isUint T in))
            (str "isUint(" (pr-str in) ") = " (.isUint T in) ", expected " expected)))
  (doseq [[in expected] [["gpu" true] ["storage" true] ["data" true] ["location" true]
                         ["GPU" false] ["cpu" false] ["" false] [nil false]]]
    (check! (str "isResourceType-" (pr-str in))
            (= expected (.isResourceType T in))
            (str "isResourceType(" (pr-str in) ") = " (.isResourceType T in)
                 ", expected " expected))))

;; ── D. every id the TypeScript suite uses must be unaffected ────────
;;
;; That suite cannot be installed here, so it cannot speak for itself. These are
;; the id literals it passes; a change to key derivation that moved any of them
;; would break it silently, off-camera.

(defn check-ts-suite-ids! [T]
  (let [ts-test-path (path/join pkg-dir "test" "resource-provider.test.ts")]
    (if-not (fs/existsSync ts-test-path)
      (println "SKIP  ts-suite-ids -- test/resource-provider.test.ts is absent")
      (let [ts (fs/readFileSync ts-test-path "utf8")
            ids (->> (re-seq #"(?:listingId|statId|profileId|entryId|ledgerId|balanceId): \"([^\"]*)\"" ts)
                     (map second) (remove str/blank?) distinct sort vec)]
        (when (< (count ids) 10)
          (refuse! (str "expected the TypeScript suite's id literals, extracted only "
                        (count ids) " -- the extraction is broken, not the code")))
        (println (str "SCANNED " (count ids) " id literals from the TypeScript suite"))
        (doseq [id ids]
          (check! (str "ts-suite-id-unchanged-" id)
                  (= (str "listing-" (str/lower-case id)) (.rkeyOf T "listing" id))
                  (str "record key for " (pr-str id) " moved to "
                       (pr-str (.rkeyOf T "listing" id)))))))))

;; ── E. no collection may be declared without a side of the boundary ─

(defn check-declaration-completeness! []
  (let [declared (->> (re-seq #"export const [A-Z_]+(?:_COLLECTION|_INNER_TYPE) = \"([^\"]+)\"" types-src)
                      (map second) set)
        classified (into plaintext-collections sealed-inner-types)]
    (when (< (count declared) 6)
      (refuse! (str "expected the six declared collections/inner types, found "
                    (count declared) " -- the extraction is broken, not the code")))
    (println (str "SCANNED " (count declared) " declared collections/inner types"))
    (check! "every-declared-collection-is-on-one-side-of-the-boundary"
            (= declared classified)
            (str "unclassified: " (pr-str (into #{} (remove classified declared)))
                 "  classified-but-not-declared: "
                 (pr-str (into #{} (remove declared classified)))))))

;; ── entry point ─────────────────────────────────────────────────────

(defn evidence-floor! [T R]
  (let [ops (js->clj (js/Object.keys R))]
    (when-not (= 17 (count ops))
      (refuse! (str "expected the registry's 17 operations, loaded " (count ops))))
    (println (str "SCANNED " (count ops) " registry operations"))
    (doseq [f ["isUint" "isPct" "isDecimalString" "isResourceType" "rkeyOf"
               "listingDidFor" "statDidFor"]]
      (when-not (fn? (aget T f))
        (refuse! (str "types.ts no longer exports " f))))))

;; Loading .ts directly needs node's type stripping: unflagged from v23.6, and
;; behind --experimental-strip-types from v22.6. On an older node the imports
;; below reject, and that is a REFUSAL (exit 2), not a failed check (exit 1) --
;; "I could not run the checks" must never be reportable as "the checks found
;; nothing".
(-> (p/let [T (js/import types-url)
            R (js/import (str "file://" tmp-registry))
            _ (evidence-floor! T R)
            _ (check-boundary! R)
            _ (check-identity! T R)
            _ (do (check-validators! T)
                  (check-ts-suite-ids! T)
                  (check-declaration-completeness!))]
      (fs/unlinkSync tmp-registry)
      (println (str "SCANNED " @checks " checks"))
      (if (seq @failures)
        (do (println (str "resource-provider-check: " (count @failures)
                          " FAILED -- " (str/join ", " (distinct @failures))))
            (js/process.exit 1))
        (println "resource-provider-check: OK")))
    (p/catch
     (fn [e]
       (when (fs/existsSync tmp-registry) (fs/unlinkSync tmp-registry))
       (println (str "REFUSED the suite could not complete: " (.-message e)))
       (println (str "         node " js/process.version
                     " -- loading TypeScript directly needs v23.6+, or v22.6+ with"
                     " --experimental-strip-types"))
       (println (.-stack e))
       (println "Refusing to report a pass on checks that did not run.")
       (js/process.exit 2))))
