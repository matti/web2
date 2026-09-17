build:
    cd cmd/web2 && go build -o web2 .

install: build
    ./bin/install.sh

doctor:
    web2 doctor

test:
    npm test
    cd cmd/web2 && go test ./...

e2e:
    ./e2e/run.sh

e2e-docker:
    ./e2e/run.sh --docker
