{
  description = "api-extractor-effect: the systemfsoftware and stryker-js-effect packages this workspace installs as .sfs-deps tarballs, its own release tarballs, and the tools its CI and release workflows call";

  inputs = {
    # A systemfsoftware `main` commit. Its public workspace packages arrive as
    # the `pnpm pack` tarballs its own flake builds from its own lock, never
    # from a registry. Its nixpkgs is followed so the tarballs are the bytes
    # systemfsoftware's own build produces, and so `pnpm_12` is the pnpm
    # `packageManager` pins.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware/732f66a0c85819b2005f9e0930a595bc4de91ee1";
    nixpkgs.follows = "systemfsoftware/nixpkgs";
    # stryker-js-effect at the release commit of `@systemfsoftware/stryker-js@v19.0.0`
    # and `@systemfsoftware/stryker-ignorer-effect-schema-declarations@v0.3.0`.
    # Every stryker-js-effect package comes from this one commit; stryker-config
    # comes from the systemfsoftware input. Nothing follows: its own
    # lock reproduces the released tarballs byte for byte, the integrity each
    # release tag records.
    stryker-published.url = "github:systemfsoftware/stryker-js-effect/9e81669b84711a9635eaa97b17dd13efea9f0c8c";
    # are-the-types-wrong-effect at `@systemfsoftware/arethetypeswrong-cli@v4.2.0`,
    # for its `attw` binary. Nothing follows, for the same reason.
    are-the-types-wrong-effect.url = "github:systemfsoftware/are-the-types-wrong-effect/d43a8020f7dc82a32de410823c6da5298c53a3b6";
    # The tarball builder, the consumer store and the release tools.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management/b9b4a1d48cc16241b33f9afd8ab99b82b05ce04f";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, systemfsoftware, stryker-published, are-the-types-wrong-effect, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});

      # Every @systemfsoftware package the lockfile resolves, by attribute name
      # and producer. The overrides in pnpm-workspace.yaml name each one as
      # `file:.sfs-deps/<attr>-<version>.tgz`.
      sfsPackages = {
        systemfsoftware = [
          "effect-cell-types"
          "effect-gherkin-spec"
          "effect-schema-discovery"
          "effect-schema-law"
          "effect-schema-recursion-budget"
          "effect-schema-vite"
          "effect-sim-kernel"
          "effect-spec-runtime"
          "oxlint-config-cell-architecture"
          "oxlint-config-dmmf"
          "oxlint-config-recommended"
          "oxlint-config-rule-authoring"
          "oxlint-plugin-cell-architecture"
          "oxlint-plugin-dmmf-workflow"
          "oxlint-plugin-effect-platform"
          "oxlint-plugin-effect-schema"
          "oxlint-plugin-test-discipline"
          "stryker-config"
          "tsconfig"
          "tsdown-config"
          "vitest"
          "vitest-config"
        ];
        stryker-published = [
          "stryker-framework-interface"
          "stryker-ignorer-effect-schema-declarations"
          "stryker-ignorer-in-source-vitest-block"
          "stryker-ignorer-interface"
          "stryker-ignorer-kit"
          "stryker-js"
          "stryker-js-cli-contract"
          "stryker-js-instrumenter"
          "stryker-js-plugin-interface"
          "stryker-js-plugin-runtime"
          "stryker-js-typescript-checker"
          "stryker-js-vitest-runner"
        ];
      };

      producers = system: {
        systemfsoftware = systemfsoftware.packages.${system};
        stryker-published = stryker-published.packages.${system};
      };

      # The directory the lockfile's `file:` entries point into.
      sfsDepsOf = pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          pick = producer: name:
            let
              upstream = (producers system).${producer};
              member = lib.findFirst (member: member.attr == name)
                (throw "flake.nix: ${producer} has no public workspace package named ${name}")
                upstream.workspace-tarballs.members;
            in
            { name = member.tarball; path = upstream.${member.attr}; };
        in
        pkgs.linkFarm "sfs-deps"
          (lib.concatLists (lib.mapAttrsToList (producer: names: map (pick producer) names) sfsPackages));

      # This workspace's public members as `pnpm pack` tarballs, and the offline
      # store its lockfile installs from.
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
          files.".sfs-deps" = sfsDepsOf pkgs;
        };
    in
    {
      packages = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          workspace = workspaceOf pkgs;
          own = {
            sfs-deps = sfsDepsOf pkgs;
            # The planner reusable-checks.yml runs in its plan and timings lanes.
            test-timings = systemfsoftware.packages.${system}.test-timings;
            attw = are-the-types-wrong-effect.packages.${system}.attw;
            default = self.packages.${system}.sfs-deps;
          };
          clashes = builtins.attrNames (builtins.intersectAttrs own workspace);
        in
        assert clashes == [ ] || throw "flake.nix: workspace packages ${lib.concatStringsSep ", " clashes} collide with flake packages";
        workspace // own);

      # The offline pnpm store for this lockfile: every registry package plus the
      # .sfs-deps tarballs of both producers, each indexed under the integrity
      # the lockfile records. It fails to build when a recorded integrity does
      # not match the flake's tarball. With these arguments it is the same
      # derivation as `packages.<system>.pnpm-store`.
      checks = forEachSystem (pkgs: {
        consumer-store = pnpm-release-management.lib.mkPnpmConsumerStore {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
          files.".sfs-deps" = sfsDepsOf pkgs;
        };
      });

      # The shell the reusable release and changeset-check workflows run their
      # tools in. pnpm_12 is the pnpm `packageManager` pins; the sandbox installs
      # from SANDBOX_PNPM_STORE.
      devShells = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.pnpm_12
              # version-management and github-release-management, which the
              # reusable release workflow runs through `nix develop --command`
              pnpm-release-management.packages.${system}.release-tools
              # `pnpm run bootstrap` and the changeset check run inside it
              pnpm-release-management.packages.${system}.sandbox
            ];
            SANDBOX_PNPM_STORE = self.packages.${system}.pnpm-store;
            # The lockfile names the tarballs under `.sfs-deps/`. They are
            # copied, not linked: the sandbox cannot read a store path outside
            # its own closure.
            shellHook = ''
              sfs_deps="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.sfs-deps"
              rm -rf "$sfs_deps" && mkdir -p "$sfs_deps"
              cp -L ${self.packages.${system}.sfs-deps}/*.tgz "$sfs_deps"/
              chmod u+w "$sfs_deps"/*.tgz
            '';
          };
        });
    };
}
