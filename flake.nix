{
  description = "api-extractor-effect: the systemfsoftware packages this workspace installs, as .sfs-deps tarballs";

  inputs = {
    # A systemfsoftware `main` commit. Its public workspace packages arrive as
    # the `pnpm pack` tarballs its own flake builds from its own lock, never
    # from a registry. Its nixpkgs is followed so the tarballs are the bytes
    # systemfsoftware's own build produces.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware/ba6664c1859701ed1605d2c0af0ae78bc70e50da";
    nixpkgs.follows = "systemfsoftware/nixpkgs";
  };

  outputs = { self, nixpkgs, systemfsoftware }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});

      # Every @systemfsoftware package the lockfile resolves, by attribute name.
      # package.json and the overrides in pnpm-workspace.yaml name each one as
      # `file:.sfs-deps/<attr>-<version>.tgz`.
      sfsPackages = [ "effect-cell-types" "effect-schema-law" "tsconfig" "vitest" ];
    in
    {
      packages = forEachSystem (pkgs:
        let
          upstream = systemfsoftware.packages.${pkgs.stdenv.hostPlatform.system};
          chosen = map (name:
            lib.findFirst (member: member.attr == name)
              (throw "flake.nix: systemfsoftware has no public workspace package named ${name}")
              upstream.workspace-tarballs.members)
            sfsPackages;
        in
        {
          # The directory the lockfile's `file:` entries point into.
          sfs-deps = pkgs.linkFarm "sfs-deps"
            (map (member: { name = member.tarball; path = upstream.${member.attr}; }) chosen);
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.sfs-deps;
        });

      # The offline pnpm store for this lockfile: every registry package plus the
      # .sfs-deps tarballs, each indexed under the integrity the lockfile records.
      # It fails to build when a recorded integrity does not match the flake's tarball.
      checks = forEachSystem (pkgs: {
        consumer-store = systemfsoftware.lib.mkConsumerStore {
          inherit pkgs;
          src = self;
          packages = sfsPackages;
        };
      });
    };
}
