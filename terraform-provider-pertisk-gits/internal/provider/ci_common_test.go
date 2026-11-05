package provider

import "testing"

func TestNormalizeCiScope(t *testing.T) {
	cases := map[string]string{
		"server":     "server",
		"instance":   "server",
		"group":      "group",
		"org":        "group",
		"repository": "repository",
		"repo":       "repository",
		"project":    "repository",
	}
	for in, want := range cases {
		got, err := normalizeCiScope(in)
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if got != want {
			t.Fatalf("%s: got %s want %s", in, got, want)
		}
	}
}

func TestParseCiImportID(t *testing.T) {
	scope, org, repo, name, env, uuid, err := parseCiImportID("group/platform/team/SONAR_TOKEN/all")
	if err != nil {
		t.Fatal(err)
	}
	if scope != "group" || org != "platform/team" || repo != "" || name != "SONAR_TOKEN" || env != "all" || uuid != "" {
		t.Fatalf("unexpected parse: %s %s %s %s %s %s", scope, org, repo, name, env, uuid)
	}

	scope, org, repo, name, env, uuid, err = parseCiImportID("repo/platform/app/DEPLOY_TOKEN/prd")
	if err != nil {
		t.Fatal(err)
	}
	if scope != "repository" || org != "platform" || repo != "app" || name != "DEPLOY_TOKEN" || env != "prd" {
		t.Fatalf("unexpected parse: %s %s %s %s %s", scope, org, repo, name, env)
	}

	scope, org, repo, name, env, uuid, err = parseCiImportID("server/HARBOR_REGISTRY/all")
	if err != nil {
		t.Fatal(err)
	}
	if scope != "server" || name != "HARBOR_REGISTRY" || env != "all" {
		t.Fatalf("unexpected parse: %s %s %s", scope, name, env)
	}
}
