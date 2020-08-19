import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as serviceDiscovery from "@aws-cdk/aws-servicediscovery";
import * as iam from "@aws-cdk/aws-iam";
const environment = "ecsworkshop";

// Creating a construct that will populate the required objects created in the platform repo such as vpc, ecs cluster, and service discovery namespace
class BasePlatform extends cdk.Stack {
  environmentName: string;
  vpc: ec2.IVpc;
  sdNamespace: serviceDiscovery.IPrivateDnsNamespace;
  ecsCluster: ecs.ICluster;
  servicesSecGrp: ec2.ISecurityGroup;
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The base platform stack is where the VPC was created, so all we need is the name to do a lookup and import it into this stack for use
    this.vpc = ec2.Vpc.fromLookup(this, "VPC", {
      vpcName: `${environment}-base/BaseVPC`,
    });

    this.sdNamespace = serviceDiscovery.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(
      this,
      "SDNamespace",
      {
        namespaceName: cdk.Fn.importValue("NSNAME"),
        namespaceArn: cdk.Fn.importValue("NSARN"),
        namespaceId: cdk.Fn.importValue("NSID"),
      }
    );

    this.ecsCluster = ecs.Cluster.fromClusterAttributes(this, "ECSCluster", {
      clusterName: cdk.Fn.importValue("ECSClusterName"),
      securityGroups: [],
      vpc: this.vpc,
      defaultCloudMapNamespace: this.sdNamespace,
    });

    this.servicesSecGrp = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ServicesSecGrp",
      cdk.Fn.importValue("ServicesSecGrp")
    );
  }
}

class NodejsService extends cdk.Stack {
  basePlatform: BasePlatform;
  fargateTaskDef: ecs.TaskDefinition;
  container: ecs.ContainerDefinition;
  fargateService: any;
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //  Importing our shared values from the base stack construct
    this.basePlatform = new BasePlatform(this, id, props);

    // The task definition is where we store details about the task that will be scheduled by the service
    this.fargateTaskDef = new ecs.TaskDefinition(this, "TaskDef", {
      compatibility: ecs.Compatibility.EC2_AND_FARGATE,
      cpu: "256",
      memoryMiB: "512",
    });

    // The container definition defines the container(s) to be run when the task is instantiated
    this.container = this.fargateTaskDef.addContainer(
      "NodeServiceContainerDef",
      {
        image: ecs.ContainerImage.fromRegistry("brentley/ecsdemo-nodejs:cdk"),
        memoryLimitMiB: 512,
        logging: ecs.LogDriver.awsLogs({ streamPrefix: "ecsworkshop-nodejs" }),
        environment: {
          REGION: process.env.AWS_DEFAULT_REGION || "eu-central-1",
        },
      }
    );

    // Serve this container on port 3000
    this.container.addPortMappings({ containerPort: 3000 });

    // Build the service definition to schedule the container in the shared cluster
    this.fargateService = new ecs.FargateService(this, "NodejsFargateService", {
      taskDefinition: this.fargateTaskDef,
      cluster: this.basePlatform.ecsCluster,
      securityGroup: this.basePlatform.servicesSecGrp,
      desiredCount: 1,
      cloudMapOptions: {
        cloudMapNamespace: this.basePlatform.sdNamespace,
        name: "ecsDemo-nodejs",
      },
    });

    this.fargateTaskDef.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeSubnets"],
        resources: ["*"],
      })
    );
  }
}

const env: cdk.Environment = {
  account: process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION,
};

const stack_name = `${environment}-nodejs`;
const app = new cdk.App();
new NodejsService(app, stack_name, { env });
app.synth();
