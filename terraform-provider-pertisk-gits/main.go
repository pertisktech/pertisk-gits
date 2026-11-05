package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/pertisktech/pertisk-gits/terraform-provider-pertisk-gits/internal/provider"
)

var version = "0.1.0"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run the provider with debugger support")
	flag.Parse()

	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.terraform.io/pertisktech/pertisk-gits",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err.Error())
	}
}
