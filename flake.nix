{
  description = "api-extractor-effect: its workspace packages, the tools its CI and release workflows call, and the @systemfsoftware packages it installs from nix.systemfsoftware.com";

  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
    fallback = true;
  };

  inputs = {
    # Producers are pinned to their default-branch commit that pushes
    # `workspace-tarballs`. A producer input carries no `follows`: its tarballs
    # are input-addressed by the nixpkgs they were evaluated with.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware/e1c7a5f4655d1705de502ebe0de3c1fa87e35591";
    nixpkgs.follows = "systemfsoftware/nixpkgs";
    stryker-published.url = "github:systemfsoftware/stryker-js-effect/bc8680e836d3df9f80dc69770a9a91390447f8f1";
    # are-the-types-wrong-effect for its `attw` binary, and as a producer.
    are-the-types-wrong-effect.url = "github:systemfsoftware/are-the-types-wrong-effect/2650b6a0c6cd3b2abdb7f429a5a55dd5221588ca";
    # The tarball builder, the consumer store and the release tools.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management/741c8c4334c261058dd4a3b2976c9f2e3796d523";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, systemfsoftware, stryker-published, are-the-types-wrong-effect, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});

      # Every public member of each producer, as `<attr>.tgz` under `.deps/`.
      producerTarballsOf = pkgs: pnpm-release-management.lib.mkProducerTarballs {
        inherit pkgs;
        producers = { inherit systemfsoftware stryker-published; };
      };

      # This workspace's public members as `pnpm pack` tarballs, and the offline
      # store its lockfile installs from.
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
          files.".deps" = producerTarballsOf pkgs;
        };
    in
    {
      packages = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          workspace = workspaceOf pkgs;
          own = {
            producer-tarballs = producerTarballsOf pkgs;
            # The planner reusable-checks.yml runs in its plan and timings lanes.
            test-timings = systemfsoftware.packages.${system}.test-timings;
            attw = are-the-types-wrong-effect.packages.${system}.attw;
          };
          clashes = builtins.attrNames (builtins.intersectAttrs own workspace);
        in
        assert clashes == [ ] || throw "flake.nix: workspace packages ${lib.concatStringsSep ", " clashes} collide with flake packages";
        workspace // own);

      # The offline pnpm store for this lockfile: every registry package plus the
      # producer tarballs, each indexed under the integrity the lockfile records.
      # It fails to build when a recorded integrity does not match the flake's
      # tarball.
      checks = forEachSystem (pkgs: {
        consumer-store = pnpm-release-management.lib.mkPnpmConsumerStore {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
          files.".deps" = producerTarballsOf pkgs;
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
            # The lockfile names the producer tarballs under `.deps/`. The hook
            # copies them in as real files: the sandbox cannot read a store path
            # outside its own closure.
            shellHook = self.packages.${system}.producer-tarballs.shellHook;
          };
        });
    };
}
