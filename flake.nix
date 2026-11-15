{
  description = "api-extractor-effect: its workspace packages, the tools its CI and release workflows call, and the offline pnpm store of its lockfile";

  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
  };

  inputs = {
    # Core, for its nixpkgs and the test-timings planner.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware/3ef6c21c36f19a539078b6817b495df3039cc163";
    nixpkgs.follows = "systemfsoftware/nixpkgs";
    # are-the-types-wrong-effect for its `attw` binary.
    are-the-types-wrong-effect.url = "github:systemfsoftware/are-the-types-wrong-effect/2650b6a0c6cd3b2abdb7f429a5a55dd5221588ca";
    # The tarball builder, the consumer store and the release tools.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management/ebebdfebf30205b508840ea55801d55283af7648";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, systemfsoftware, are-the-types-wrong-effect, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});

      # This workspace's public members as `pnpm pack` tarballs, and the offline
      # store its lockfile installs from.
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
        };
    in
    {
      packages = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          workspace = workspaceOf pkgs;
          own = {
            # The planner reusable-checks.yml runs in its plan and timings lanes.
            test-timings = systemfsoftware.packages.${system}.test-timings;
            attw = are-the-types-wrong-effect.packages.${system}.attw;
          };
          clashes = builtins.attrNames (builtins.intersectAttrs own workspace);
        in
        assert clashes == [ ] || throw "flake.nix: workspace packages ${lib.concatStringsSep ", " clashes} collide with flake packages";
        workspace // own);

      # The offline pnpm store for this lockfile: every registry package, each
      # indexed under the integrity the lockfile records.
      checks = forEachSystem (pkgs: {
        consumer-store = pnpm-release-management.lib.mkPnpmConsumerStore {
          inherit pkgs;
          src = self;
          pname = "api-extractor-effect";
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
          };
        });
    };
}
