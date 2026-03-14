# EditUsers Plugin - Mise à jour Vencord/Equicord

## Changements appliqués (Mars 2026)

### ✨ Améliorations principales

1. **Recherche d'icône plus robuste**
   - Utilisation d'un fallback pour `findByCodeLazy`
   - Ajout de `findByPropsLazy` en secours
   - Meilleure gestion des cas où l'icône n'est pas trouvée

2. **Gestion d'erreurs améliorée**
   - Try-catch blocks dans `start()` et `stop()`
   - Logs d'erreur détaillés
   - Plus de robustesse lors du démarrage/arrêt du plugin

3. **Types TypeScript modernes**
   - `ClientUser` étend maintenant `User` correctement
   - Meilleure compatibilité avec les types actuels de Discord
   - Types optionnels (`?`) pour les propriétés qui peuvent ne pas exister

4. **Patches Webpack plus stables**
   - Regex mises à jour pour correspondre aux versions actuelles
   - `optional: true` pour éviter les crashs si le patch ne trouve pas de correspondance
   - Fallbacks intégrés

5. **Sécurité des données**
   - Vérifications null/undefined améliorées avant d'accéder aux propriétés
   - Initialisation correcte des structures de changement
   - `Object.assign` au lieu de boucles for...in

6. **Valeurs par défaut améliorées**
   - Utilisation de `??` (nullish coalescing) au lieu de `||`
   - Fallback vers `username` si `globalName` n'existe pas
   - Meilleure gestion des cas limites

7. **Édition d'Avatar et Bannière** (Nouveau!)
   - Champs URL pour modifier l'avatar et la bannière
   - Aperçus en temps réel des images
   - Styles CSS optimisés pour l'affichage
   - **Upload direct de fichiers** (JPG, PNG, GIF, etc.)
   - Les images sont converties en base64 et stockées localement

## Fichiers modifiés

- **index.tsx** - Mise à jour complète du plugin
- **types.ts** - Amélioration des types TypeScript
- **style.css** - Inchangé, déjà à jour

## Utilisation

1. Placez le plugin dans votre dossier `userplugins`
2. Rechargez Vencord/Equicord
3. Clic droit sur un utilisateur → "Edit user"
4. Modifiez les champs disponibles :
   - **Display Name** : Le nom d'affichage de l'utilisateur
   - **Avatar URL** :
     - Entrez une URL directement
     - OU cliquez sur le champ "Choose File" pour uploader une image
   - **Banner URL** :
     - Entrez une URL directement
     - OU cliquez sur le champ "Choose File" pour uploader une image
5. Les aperçus des images s'affichent en temps réel
6. Les changements sont sauvegardés automatiquement

## Notes d'upload

- Les fichiers supportés : JPG, PNG, GIF, WebP, etc.
- Les images sont converties en base64 (data URLs) et stockées localement dans DataStore
- Aucun upload vers un serveur externe - tout est stocké en local
- Vous pouvez coller directement une data URL si vous en avez une

## Notes

⚠️ **Le plugin est toujours en [WIP]** - Les patches webpack peuvent nécessiter des ajustements si Discord change sa structure interne.

Si les patches ne fonctionnent pas:
1. Vérifiez la console pour les erreurs
2. Les patches marqués `optional: true` ne causeront pas de crash
3. Vous pouvez mettre à jour les regex `find` et `match` si nécessaire

## Compatibilité

- Vencord version actuelle (2026+)
- Equicord et forks compatibles
- TypeScript 5.0+
- Discord client actuel
