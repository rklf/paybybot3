# paybybot — le guide simple

paybybot vous permet de **payer votre stationnement PayByPhone depuis votre ordinateur**, en quelques clics,
et, si vous êtes riverain, de **renouveler automatiquement votre forfait résident chaque semaine** pour ne plus oublier de le reprendre.

![Le principe](https://img.shields.io/badge/vos_identifiants-restent_sur_votre_ordinateur-1d4ea3)

## 1. Télécharger

Sur la page GitHub du projet, cliquez sur le bouton vert **Code**, puis **Download ZIP**.
Ouvrez le fichier téléchargé pour obtenir un dossier `paybybot3`.

## 2. Lancer

- **Sur Mac** : double-cliquez sur **`Lancer paybybot.command`**.
  La première fois, macOS peut refuser de l'ouvrir : faites alors *clic droit → Ouvrir → Ouvrir*.
- **Sur Windows** : double-cliquez sur **`Lancer paybybot.bat`**.

Si Python n'est pas installé, la page de téléchargement s'ouvre : installez-le (sous Windows, cochez
*« Add Python to PATH »*), puis relancez le fichier.

La première fois, l'installation prend environ une minute. Ensuite, votre navigateur s'ouvre tout seul sur l'application.
**Laissez la petite fenêtre noire ouverte** tant que vous utilisez paybybot.

## 3. Utiliser

1. Connectez-vous avec **vos identifiants PayByPhone** (ceux de l'application sur votre téléphone).
   Pour essayer sans compte, cliquez sur **Essayer sans compte (démo)** : aucun paiement réel.
2. Cliquez sur **Payer un stationnement** et laissez-vous guider :
   voiture → zone (à Paris, le code postal de la rue, par exemple `75015`) → tarif → durée → carte → vérification.
3. Le prix exact s'affiche **avant** de payer.
4. **Riverain ?** Cliquez sur la carte verte **Renouvellement automatique chaque semaine**, vérifiez la zone de
   votre domicile, puis **Activer** : votre forfait résident de 7 jours est repayé tout seul à chaque expiration.
   Cela fonctionne tant que l'application reste ouverte sur l'ordinateur. Le lien **Arrêter** le désactive.

Votre voiture et votre carte doivent déjà être enregistrées dans votre compte PayByPhone (sur votre téléphone).

## Questions fréquentes

**Mes identifiants sont-ils envoyés ailleurs ?**
Non. L'application tourne uniquement sur votre ordinateur et parle directement à PayByPhone, comme l'application officielle.
Votre mot de passe n'est enregistré nulle part : il faut se reconnecter à chaque lancement.

**« Identifiant ou mot de passe incorrect »**
Vérifiez que vous arrivez à vous connecter sur [m.paybyphone.com](https://m.paybyphone.com) avec les mêmes identifiants.

**« Aucun tarif trouvé pour cette zone »**
Vérifiez le numéro de zone indiqué sur l'horodateur ou les panneaux de la rue.

**Est-ce un outil officiel PayByPhone ?**
Non, c'est un projet open source indépendant. Utilisez-le à vos risques ; en cas de doute, vérifiez votre
stationnement dans l'application officielle.
